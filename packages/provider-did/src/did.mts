/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
	type GrantContext,
	type GrantDependencies,
	type GrantHandler,
	type GrantHandlerResult,
	generateToken,
	generateTokenResponse,
} from "@o3co/auth-provider-core";
import { InMemoryNonceStore, type NonceStore } from "./nonceStore.mjs";
import { ResolutionRejectedError, ResolutionUnavailableError } from "./resolver/errors.mjs";
import { extractVerificationKey } from "./resolver/extractKey.mjs";
import {
	type RelationshipName,
	type SelectedMethod,
	selectVerificationMethod,
} from "./resolver/selectMethod.mjs";
import type { DidDocumentResolver } from "./resolver/types.mjs";
import {
	type AuthContractId,
	parseLoginTranscript,
	TranscriptError,
	validateOwnerLogin,
} from "./transcript.mjs";
import { detectAlgorithm } from "./verifiers/detect.mjs";
import { createDefaultVerifierRegistry } from "./verifiers/factory.mjs";
import type { VerifierRegistry } from "./verifiers/registry.mjs";
import type { SignatureVerifier } from "./verifiers/types.mjs";

export interface DidGrantOptions {
	resolver: DidDocumentResolver;
	verifierRegistry?: VerifierRegistry;
	nonceStore?: NonceStore;
}

/**
 * The P0-mint authorization scope — the ONLY scope value this handler ever
 * issues (rule `auth.token.signed-claims`). The spec taxonomy also defines
 * `CURRENT_AUTHORIZATION_AT_REQUEST@1` for a later, non-P0 minting mode;
 * this package does not mint it.
 */
export const AUTHZ_SCOPE_AT_ISSUANCE =
	"AUTHORIZATION_AT_ISSUANCE_WITH_MAX_AGE@1";

/**
 * The bound inputs to a single authorization decision, assembled exactly
 * once per request (rule `auth.resolve.single-input-binding`) so every
 * token claim below traces back to one coherent snapshot instead of being
 * re-derived piecemeal at mint time.
 *
 * P0 lifecycle refs are the registry snapshot digest + retrieval instant —
 * a documented projection until a real lifecycle service exists.
 */
interface EvaluationInput {
	/** `resolution.digest` — `"sha256:<64hex>"`, prefixed (see `keyDigest` below for the bare-hex counterpart). */
	documentDigest: string;
	/** Selected method id — the OWNER-certified method on the OWNER path, `extractVerificationKey`'s result's `.id` on LEGACY. */
	methodId: string;
	/**
	 * sha256 hex over the canonical JSON of the selected verification
	 * method — a P0 projection (`JSON.stringify`, NOT full JCS canonical
	 * form). Bare lowercase hex with NO `sha256:` prefix — contrast
	 * `documentDigest` above, which keeps the prefix it arrives with from
	 * `resolution.digest`.
	 */
	keyDigest: string;
	/** The DID Document relationship the OWNER path certified the key against, or `"legacy"` on the relationship-blind LEGACY path. */
	relationship: RelationshipName | "legacy";
	/** `resolution.snapshotRef`. */
	lifecycleStateRef: string;
	/** `resolution.retrievedAt`. */
	lifecycleFreshnessRef: string;
}

/**
 * Algorithms whose signed envelope carries a JWS protected header — the
 * only place a `kid` can legitimately come from (`ed25519Raw.mts` /
 * `ed25519Prehash.mts` explicitly strip any `headerKid` member a signed
 * payload tries to smuggle in, rather than trust it; `jws.mts`'s
 * `JwsVerifier` is the only verifier that ever sets it, from the real
 * protected header). An OWNER contract's three-way kid match (rule
 * `auth.grant.kid-match`) is unsatisfiable without one, so every configured
 * `supportedAlgorithms` entry must be in this set when `authContract` is
 * OWNER_* — checked at boot (see the guard below), not left to fail one
 * request at a time.
 */
const OWNER_COMPATIBLE_ALGORITHMS: ReadonlySet<string> = new Set([
	"ed25519_jws",
	"es256_jws",
	"es256k_jws",
]);

/**
 * OWNER contract -> required DID Document relationship. Rule (see
 * `AuthContractId`'s doc comment in `transcript.mts`): "the two `OWNER_*`
 * values are transcript-bearing contracts distinguished by which DID
 * Document relationship the signing key must appear in (`authentication`
 * vs `assertionMethod`)". `OWNER_AUTHENTICATION_LOGIN@1` is the Fork-Y
 * (`authentication`) contract; `OWNER_ASSERTION_CONTROL_LOGIN@1` is the
 * `assertionMethod` counterpart.
 */
function ownerRelationshipFor(
	contract: "OWNER_AUTHENTICATION_LOGIN@1" | "OWNER_ASSERTION_CONTROL_LOGIN@1",
): RelationshipName {
	switch (contract) {
		case "OWNER_AUTHENTICATION_LOGIN@1":
			return "authentication";
		case "OWNER_ASSERTION_CONTROL_LOGIN@1":
			return "assertionMethod";
	}
}

/**
 * SHA-256 hex digest of a UTF-8 string via Web Crypto (`crypto.subtle`) —
 * the same primitive `verifiers/ed25519Prehash.mts` uses for its message
 * hash, no extra hashing dependency. Returns bare lowercase hex with NO
 * `sha256:` prefix; callers that need the prefixed form (matching
 * `ResolutionResult.digest`) add it themselves.
 */
async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Rule `auth.resolve.failure-mapping`: maps a caught resolve/select
 * failure to its HTTP outcome. `ResolutionUnavailableError` means the
 * registry could not be reached, or is reachable but failing transiently —
 * the DID itself may still be valid, so this is INDETERMINATE and maps to
 * 503 (a client can retry). `ResolutionRejectedError` — every `resolve()`
 * failure now lands in one of these two classes (errors.mts's two-class
 * taxonomy) — is FAILED and maps to 400 `invalid_grant`, echoing its
 * message: that message is resolver-authored and already meant for a
 * client to see.
 *
 * Anything else reaching here — `MethodSelectionError` (LEGACY or OWNER
 * method-selection rejection), `TranscriptError` (OWNER-path transcript
 * rejection — malformed transcript, three-way kid mismatch, relationship
 * violation, audience/issuer/token_endpoint mismatch), or any other
 * unclassified error — is also FAILED and maps to 400 `invalid_grant`, but
 * is genuinely unexpected: don't echo its `.message`
 * into the client-facing `errorDescription` (it may carry internal detail
 * never meant for a client — stack context, raw document content, etc.);
 * use a generic description instead. Neither outcome mints a token: callers
 * return the mapped result immediately.
 */
function mapResolutionFailure(
	err: unknown,
):
	| { status: 503; error: "temporarily_unavailable"; errorDescription: string }
	| { status: 400; error: "invalid_grant"; errorDescription: string } {
	if (err instanceof ResolutionUnavailableError) {
		return { status: 503, error: "temporarily_unavailable", errorDescription: err.message };
	}
	if (err instanceof ResolutionRejectedError) {
		return { status: 400, error: "invalid_grant", errorDescription: err.message };
	}
	return {
		status: 400,
		error: "invalid_grant",
		errorDescription: "grant could not be processed",
	};
}

export const createDidGrant = (deps: GrantDependencies, options: DidGrantOptions): GrantHandler => {
	const { config, keyStore } = deps;
	const { resolver } = options;

	const DEFAULT_MESSAGE_MAX_AGE_SEC = 300;
	const DEFAULT_ALGORITHM = "ed25519_raw";
	// Mirror didConfigSchema's per-field zod defaults (module.mts) — these
	// fallbacks only fire for callers that construct a config object by hand
	// and skip `didConfigSchema.parse` (unit tests; `oauthDidModule`'s own
	// boot path always runs the parsed/defaulted config through here).
	const DEFAULT_AUTH_CONTRACT: AuthContractId = "LEGACY_DID_LOGIN@1";
	const DEFAULT_LEGACY_MAX_TTL_SEC = 900;

	const didConfig = (config.oauth.grants as Record<string, Record<string, unknown> | undefined>)
		.did;
	const messageMaxAgeMs =
		((didConfig?.messageMaxAgeSec as number | undefined) ?? DEFAULT_MESSAGE_MAX_AGE_SEC) * 1000;
	// NO fail-open default — an empty/absent allowlist used to mean "accept
	// any audience" (the original audit finding). `didConfigSchema` already
	// rejects this at parse time (Task 8), but a caller that hand-builds a
	// config and skips `didConfigSchema.parse` bypasses that check entirely;
	// the guard below closes the same hole here, mirroring the
	// `revocationLatencyBoundSec` boot-time assert below (fail closed, no
	// default, rule audit-5).
	const allowedAudiences = (didConfig?.allowedAudiences as string[] | undefined) ?? [];

	// `config.oauth.accessToken.expiresIn` is a plain count of SECONDS, not a
	// duration string or ms value: `@o3co/auth-provider-core`'s `generateToken`
	// computes `exp = Math.floor(Date.now() / 1000) + expiresIn` and puts it
	// straight into the JWT's numeric `exp` claim (seconds since epoch) — see
	// `generateToken` in `@o3co/auth-provider-core/dist/grants/token.mjs`.
	// `revocationLatencyBoundSec` / `legacyMaxTtlSec` are seconds too, so the
	// boot-time bound checks below compare like units with no conversion.
	const expiresIn = config.oauth.accessToken.expiresIn;
	const authContract =
		(didConfig?.authContract as AuthContractId | undefined) ?? DEFAULT_AUTH_CONTRACT;
	const legacyMaxTtlSec =
		(didConfig?.legacyMaxTtlSec as number | undefined) ?? DEFAULT_LEGACY_MAX_TTL_SEC;
	// NO default — didConfigSchema requires this field explicitly (fail
	// closed, rule auth.token.lifetime-bound). A config that reached this
	// point via `didConfigSchema.parse` always has it; a hand-built config
	// that omits it fails the same way rather than silently skipping the
	// bound check below.
	const revocationLatencyBoundSec = didConfig?.revocationLatencyBoundSec as number | undefined;
	const isOwnerAuthContract =
		authContract === "OWNER_AUTHENTICATION_LOGIN@1" || authContract === "OWNER_ASSERTION_CONTROL_LOGIN@1";
	// Required for `validateOwnerLogin`'s `expectedTokenEndpoint` check on the
	// OWNER path (`ValidateOwnerLoginInput.expectedTokenEndpoint`, transcript.mts).
	// `didConfigSchema.superRefine` (module.mts) already requires this at parse
	// time for an OWNER `authContract`; the guard below closes the same hole
	// for a hand-built config that skips `didConfigSchema.parse` (fail closed,
	// no default — mirrors the `allowedAudiences` / `revocationLatencyBoundSec`
	// guards above/below).
	const tokenEndpoint = didConfig?.tokenEndpoint as string | undefined;
	if (isOwnerAuthContract && !tokenEndpoint) {
		throw new Error(
			`did grant config: oauth.grants.did.tokenEndpoint is required when authContract is "${authContract}" ` +
				"— fail closed, no default",
		);
	}
	// Rule `auth.migration.enable-gate`. `didConfigSchema.superRefine`
	// (module.mts) already requires this at parse time for an OWNER
	// `authContract`; re-asserted here for a hand-built config that skips
	// `didConfigSchema.parse` (fail closed, no default — the removed Option-B
	// construction-time stopgap incidentally enforced this too, since it
	// refused every OWNER `authContract` unconditionally; this guard keeps
	// that enforcement now that the stopgap itself is gone).
	if (isOwnerAuthContract && didConfig?.ownerMigrationRatified !== true) {
		throw new Error(
			`did grant config: oauth.grants.did.ownerMigrationRatified must be true when authContract is ` +
				`"${authContract}" (rule auth.migration.enable-gate) — fail closed, no default`,
		);
	}

	if (revocationLatencyBoundSec === undefined) {
		throw new Error(
			"did grant config: revocationLatencyBoundSec is required (rule auth.token.lifetime-bound) — fail closed, no default",
		);
	}
	if (allowedAudiences.length === 0) {
		throw new Error(
			"did grant config: allowedAudiences must be a non-empty list; an empty allowlist would accept any audience (fail-closed, audit-5)",
		);
	}
	if (expiresIn > revocationLatencyBoundSec) {
		throw new Error(
			`did grant config: oauth.accessToken.expiresIn (${expiresIn}s) exceeds revocationLatencyBoundSec ` +
				`(${revocationLatencyBoundSec}s) — rule auth.token.lifetime-bound`,
		);
	}
	if (authContract === "LEGACY_DID_LOGIN@1" && expiresIn > legacyMaxTtlSec) {
		throw new Error(
			`did grant config: oauth.accessToken.expiresIn (${expiresIn}s) exceeds legacyMaxTtlSec ` +
				`(${legacyMaxTtlSec}s) for authContract "LEGACY_DID_LOGIN@1" — rule auth.legacy.did-login`,
		);
	}

	const verifierRegistry = options.verifierRegistry ?? createDefaultVerifierRegistry();

	// Resolve supportedAlgorithms with backward-compatible alias for the old `algorithm` field.
	const rawSupported = didConfig?.supportedAlgorithms as string[] | undefined;
	const rawAlgorithm = didConfig?.algorithm as string | undefined;
	const supportedAlgorithms: string[] =
		rawSupported ?? (rawAlgorithm ? [rawAlgorithm] : [DEFAULT_ALGORITHM]);

	// Validate all configured algorithms are registered
	for (const alg of supportedAlgorithms) {
		if (!verifierRegistry.has(alg)) {
			throw new Error(
				`Invalid DID grant algorithm: "${alg}". Supported: ${verifierRegistry.algorithms().join(", ")}`,
			);
		}
	}

	// Converged review finding: `ed25519_raw` / `ed25519_prehash` sign a bare
	// JSON message with no protected header at all — `parsedMessage.headerKid`
	// can only ever be `undefined` for them (enforced by both verifiers
	// stripping any `headerKid` a signed payload tries to smuggle in), so an
	// OWNER contract's three-way kid match (rule `auth.grant.kid-match`) can
	// never be satisfied on those algorithms. Fail closed at boot rather than
	// let an OWNER-configured grant accept requests that can only ever be
	// rejected — this also covers the `didConfigSchema` default
	// (`supportedAlgorithms: ["ed25519_raw"]`), which would otherwise silently
	// leave a freshly-configured OWNER contract unusable end-to-end.
	if (isOwnerAuthContract) {
		for (const alg of supportedAlgorithms) {
			if (!OWNER_COMPATIBLE_ALGORITHMS.has(alg)) {
				throw new Error(
					`did grant config: authContract "${authContract}" requires every configured ` +
						"supportedAlgorithms entry to be header-bearing (one of: " +
						`${[...OWNER_COMPATIBLE_ALGORITHMS].join(", ")}); got "${alg}" — fail closed, ` +
						"rule auth.grant.kid-match",
				);
			}
		}
	}

	// Own the default nonce store's lifecycle (its sweep interval) only when
	// we created it ourselves — an injected store is owned by whoever
	// constructed it, so `cleanup()` below must not call `.stop()` on it.
	// The if/else (rather than a ternary + cast) lets the compiler enforce
	// that `defaultNonceStore` is set if and only if we created the store,
	// so `cleanup()` only ever stops a store this function constructed.
	let nonceStore: NonceStore;
	let defaultNonceStore: InMemoryNonceStore | undefined;
	if (options.nonceStore) {
		nonceStore = options.nonceStore;
		defaultNonceStore = undefined;
	} else {
		defaultNonceStore = new InMemoryNonceStore();
		nonceStore = defaultNonceStore;
	}

	// Per-algorithm verifier cache: created lazily on first use
	const verifierCache = new Map<string, SignatureVerifier>();
	const verifierErrorCache = new Map<string, Error>();

	const getVerifier = async (algorithm: string): Promise<SignatureVerifier> => {
		const cached = verifierCache.get(algorithm);
		if (cached) return cached;

		const cachedError = verifierErrorCache.get(algorithm);
		if (cachedError) throw cachedError;

		try {
			const factory = verifierRegistry.get(algorithm);
			if (!factory) throw new Error(`Algorithm "${algorithm}" not registered`);
			const v = await factory(deps.pathResolver);
			verifierCache.set(algorithm, v);
			return v;
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			verifierErrorCache.set(algorithm, error);
			throw error;
		}
	};

	return {
		async handle(ctx: GrantContext): Promise<GrantHandlerResult> {
			const { body, issuer } = ctx;
			const did = body.did as string | undefined;

			// 1. Validate DID presence
			if (!did) {
				return {
					result: {
						status: 400,
						error: "invalid_request",
						errorDescription: "did is required",
					},
				};
			}

			// 2. Resolve DID Document. Failure mapping (rule
			// auth.resolve.failure-mapping): `ResolutionUnavailableError` (the
			// registry is unreachable/failing transiently — INDETERMINATE) maps
			// to 503; everything else (`ResolutionRejectedError` or any other
			// resolve-time error) is FAILED and maps to 400 `invalid_grant`.
			let resolution: Awaited<ReturnType<typeof resolver.resolve>>;
			try {
				resolution = await resolver.resolve(did);
			} catch (err) {
				return { result: mapResolutionFailure(err) };
			}
			// `resolution` stays in scope beyond this block — Task 9 consumes
			// the canonical bytes / digest / snapshot refs it carries.
			const didDocument = resolution.document;

			// 3. Extract verification key from DID Document. `selected` is
			// computed alongside `resolvedKey` for Task 9's `keyDigest`:
			// `extractVerificationKey` (the LEGACY delegate) already calls
			// `selectVerificationMethod` internally but only surfaces the
			// extracted key material (`ExtractedKey`), not the full
			// `VerificationMethod` object `keyDigest` needs to canonicalize.
			// The second call is deterministic and pure (no I/O) with the same
			// (doc, did) inputs as the first, so it succeeds/fails in lockstep
			// with it — the shared catch below applies the same failure
			// mapping (`MethodSelectionError` → 400 `invalid_grant`) to both.
			let resolvedKey: Awaited<ReturnType<typeof extractVerificationKey>>;
			let selected: ReturnType<typeof selectVerificationMethod>;
			try {
				resolvedKey = await extractVerificationKey(didDocument, did);
				selected = selectVerificationMethod(didDocument, { did });
			} catch (err) {
				return { result: mapResolutionFailure(err) };
			}

			// 4. Detect algorithm from request body and validate it is allowed
			const detectedAlgorithm = detectAlgorithm(body as Record<string, unknown>);
			if (!detectedAlgorithm) {
				return {
					result: {
						status: 400,
						error: "invalid_request",
						errorDescription: "unable to detect signature algorithm from request body",
					},
				};
			}
			if (!supportedAlgorithms.includes(detectedAlgorithm)) {
				return {
					result: {
						status: 400,
						error: "invalid_request",
						errorDescription: `algorithm "${detectedAlgorithm}" is not supported by this server`,
					},
				};
			}

			// 5. Get (or lazily create) the verifier for the detected algorithm
			// Note: nonce/timestamp checks happen after verification because the verifier
			// owns message parsing (format-specific). Trade-off: replay requests pay crypto
			// cost before rejection. Acceptable for PoC in-memory nonce store.
			let v: SignatureVerifier;
			try {
				v = await getVerifier(detectedAlgorithm);
			} catch (err) {
				return {
					result: {
						status: 500,
						error: "server_error",
						errorDescription: err instanceof Error ? err.message : "verifier initialization failed",
					},
				};
			}

			const verification = await v.verify({ body, did, resolvedKey });
			if (!verification.valid) {
				const status = verification.error === "invalid_grant" ? 401 : 400;
				return {
					result: {
						status,
						error: verification.error,
						errorDescription: verification.errorDescription,
					},
				};
			}

			const { parsedMessage } = verification;

			// 5b. OWNER path only: parse the signed payload as a versioned login
			// transcript (`login-transcript-v1`) and enforce it — rule
			// `auth.transcript.*` / `auth.grant.kid-match` / `auth.forky.*`. The
			// same JSON payload the verifier already parsed into `parsedMessage`
			// doubles as the transcript payload — no parallel wire format;
			// `parsedMessage.did` and `LoginTranscript.did` are literally the
			// same wire field (any further members beyond the eleven the
			// transcript requires still ride along untyped, per
			// `parseLoginTranscript`'s `additionalProperties: true`
			// tolerance). `selectVerificationMethod` here is a SEPARATE call
			// from step 3's bare (methodId-less) selection: step 3 only ever
			// needs to find "a" controller-matched key to hand the crypto
			// verifier above; THIS call certifies that the transcript's
			// self-declared `verification_method` is the exact method id,
			// that it belongs to `did`, and that it is *string*-referenced in
			// the required relationship array (`authentication` for
			// `OWNER_AUTHENTICATION_LOGIN@1`, `assertionMethod` for
			// `OWNER_ASSERTION_CONTROL_LOGIN@1` — see `ownerRelationshipFor`).
			// A document with more than one controller-matched key already
			// fails at step 3 (`MethodSelectionError` "ambiguous-legacy-
			// selection") before reaching here — genuine multi-key-per-DID
			// OWNER selection is not yet supported; narrow, pre-existing,
			// fail-closed limitation, not a new gap this step opens.
			let ownerSelected: SelectedMethod | undefined;
			let ownerRelationship: RelationshipName | undefined;
			if (isOwnerAuthContract) {
				try {
					const transcript = parseLoginTranscript(parsedMessage);
					const relationship = ownerRelationshipFor(authContract);
					ownerSelected = selectVerificationMethod(didDocument, {
						did,
						methodId: transcript.verification_method,
						relationship,
					});
					// Defense in depth: `ownerSelected` (methodId-based, just
					// above) and `resolvedKey` (step 3, bare/controller-matched)
					// are structurally guaranteed to name the same method TODAY
					// — step 3 requires exactly one controller-matched candidate,
					// so `ownerSelected`'s methodId-based lookup can only succeed
					// by finding that same candidate, or fail closed. Asserted
					// explicitly rather than left as an unchecked coincidence
					// because CHANGELOG.md flags genuine multi-key-per-DID OWNER
					// selection as tracked follow-up work: once step 3 stops being
					// a single-candidate bottleneck, this is the line that will
					// actually enforce "the minted verification_method claim is
					// the same key that produced the crypto verification" — not
					// just an emergent side effect of today's limitation.
					if (ownerSelected.id !== resolvedKey.id) {
						throw new TranscriptError(
							"verification_method",
							`OWNER-selected method "${ownerSelected.id}" does not match the crypto-verified method "${resolvedKey.id}"`,
						);
					}
					validateOwnerLogin({
						transcript,
						parsedMessage,
						selected: ownerSelected,
						did,
						expectedContract: authContract,
						// `ctx.issuer` is the same value the LEGACY path already feeds
						// straight into `generateToken`'s `issuer` option below — an
						// absent `ctx.issuer` becomes `""`, which can never equal a
						// transcript's required non-empty `issuer` field, so this
						// fails closed rather than needing a separate presence check.
						expectedIssuer: issuer ?? "",
						// Guaranteed non-empty here — the boot-time guard above throws
						// otherwise for an OWNER authContract.
						expectedTokenEndpoint: tokenEndpoint ?? "",
						allowedAudiences,
					});
					ownerRelationship = relationship;
				} catch (err) {
					return { result: mapResolutionFailure(err) };
				}
			}

			// 6. Validate nonce and timestamp presence
			if (!parsedMessage.nonce || !parsedMessage.timestamp) {
				return {
					result: {
						status: 400,
						error: "invalid_request",
						errorDescription: "message must include nonce and timestamp",
					},
				};
			}

			// 7. Validate timestamp freshness
			const messageTime = new Date(parsedMessage.timestamp).getTime();
			const now = Date.now();
			if (Number.isNaN(messageTime) || Math.abs(now - messageTime) > messageMaxAgeMs) {
				return {
					result: {
						status: 400,
						error: "invalid_request",
						errorDescription: "message timestamp is expired or invalid",
					},
				};
			}

			// 8. Nonce replay check + store (single `consume` call). Expiry
			// mirrors the freshness window enforced in step 7 above, reusing
			// the same `now` so the nonce's lifetime matches the message's.
			const nonceKey = `did-nonce:${parsedMessage.nonce}`;
			const nonceExpiresAtMs = now + messageMaxAgeMs;
			if (!(await nonceStore.consume(nonceKey, nonceExpiresAtMs))) {
				return {
					result: {
						status: 400,
						error: "invalid_request",
						errorDescription: "nonce already used",
					},
				};
			}

			// 9. Validate audience against allowlist. `allowedAudiences` is
			// guaranteed non-empty here — the boot-time guard above throws
			// otherwise (audit-5) — so the only remaining case that skips this
			// check is a request that carries no audience claim at all
			// (unchanged, out of scope for audit-5). On the OWNER path this
			// branch is defense in depth, not the primary enforcement point:
			// `audience` is one of the transcript's eleven required non-empty
			// fields (`parseLoginTranscript`), so an OWNER request with no
			// audience claim was already rejected in step 5b above, and
			// `validateOwnerLogin` re-checks `transcript.audience` (== this
			// same `verification.audience`, same underlying JSON payload)
			// against the same `allowedAudiences` allowlist.
			// Note: the nonce is already consumed at this point (step 8), so a
			// request that fails the audience check still burns its nonce — a
			// deliberate change from the pre-NonceStore code, which stored the
			// nonce only after this check passed. `consume()` fuses check+store
			// into one call placed at the old check position to preserve error
			// precedence (replay is reported before audience); the trade-off is
			// audience-rejected requests can no longer retry with the same nonce.
			// Asymmetry vs. the OWNER path: step 5b's transcript rejections
			// (malformed transcript, kid mismatch, relationship violation, bad
			// audience/issuer/token_endpoint) run BEFORE step 8's nonce
			// consumption, so they never burn the nonce — only a LEGACY
			// audience failure reaches this post-consume position.
			if (verification.audience) {
				if (!allowedAudiences.includes(verification.audience)) {
					return {
						result: {
							status: 400,
							error: "invalid_request",
							errorDescription: `audience "${verification.audience}" is not allowed`,
						},
					};
				}
			}

			// 10. Assemble the single EvaluationInput this decision is bound to
			// (rule auth.resolve.single-input-binding) — every token claim below
			// reads from this one object rather than being re-derived piecemeal.
			// On the OWNER path, `methodId`/`keyDigest` come from step 5b's
			// relationship-certified `ownerSelected` (not step 3's bare
			// selection) so the minted `verification_method` claim reflects the
			// method that was actually checked against the required
			// relationship array; step 3's structurally-equal `resolvedKey`/
			// `selected` stays the source on the LEGACY path (unchanged).
			const input: EvaluationInput = {
				documentDigest: resolution.digest,
				methodId: ownerSelected ? ownerSelected.id : resolvedKey.id,
				keyDigest: await sha256Hex(JSON.stringify(ownerSelected ? ownerSelected.method : selected.method)),
				relationship: ownerRelationship ?? "legacy",
				lifecycleStateRef: resolution.snapshotRef,
				lifecycleFreshnessRef: resolution.retrievedAt,
			};

			// 11. Generate token, minting the six required claims (rules
			// auth.token.signed-claims / auth.token.issuance-vs-request) from
			// `input` above.
			return {
				result: {
					status: 200,
					tokens: generateTokenResponse({
						accessToken: await generateToken(
							{
								auth_contract_id: authContract,
								verification_method: input.methodId,
								did_document_snapshot: input.documentDigest,
								lifecycle_state_ref: input.lifecycleStateRef,
								lifecycle_freshness_ref: input.lifecycleFreshnessRef,
								authorization_scope: AUTHZ_SCOPE_AT_ISSUANCE,
							},
							{
								expiresIn,
								keyStore,
								issuer,
								subject: verification.subject,
								authorizedParty: verification.audience ?? null,
								tokenType: "at+jwt",
								audience: verification.audience,
							},
						),
					}),
				},
			};
		},

		cleanup(): void {
			defaultNonceStore?.stop();
		},
	};
};
