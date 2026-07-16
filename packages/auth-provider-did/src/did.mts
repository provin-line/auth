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
import { extractVerificationKey } from "./resolver/extractKey.mjs";
import type { DidDocumentResolver } from "./resolver/types.mjs";
import type { AuthContractId } from "./transcript.mjs";
import { detectAlgorithm } from "./verifiers/detect.mjs";
import { createDefaultVerifierRegistry } from "./verifiers/factory.mjs";
import type { VerifierRegistry } from "./verifiers/registry.mjs";
import type { SignatureVerifier } from "./verifiers/types.mjs";

export interface DidGrantOptions {
	resolver: DidDocumentResolver;
	verifierRegistry?: VerifierRegistry;
	nonceStore?: NonceStore;
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

			// 2. Resolve DID Document
			let resolution: Awaited<ReturnType<typeof resolver.resolve>>;
			try {
				resolution = await resolver.resolve(did);
			} catch (err) {
				return {
					result: {
						status: 400,
						error: "invalid_request",
						errorDescription: err instanceof Error ? err.message : "DID resolution failed",
					},
				};
			}
			// `resolution` stays in scope beyond this block — Task 9 consumes
			// the canonical bytes / digest / snapshot refs it carries.
			const didDocument = resolution.document;

			// 3. Extract verification key from DID Document
			let resolvedKey: Awaited<ReturnType<typeof extractVerificationKey>>;
			try {
				resolvedKey = await extractVerificationKey(didDocument, did);
			} catch (err) {
				return {
					result: {
						status: 400,
						error: "invalid_request",
						errorDescription: err instanceof Error ? err.message : "key extraction failed",
					},
				};
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
			// (unchanged, out of scope for audit-5).
			// Note: the nonce is already consumed at this point (step 8), so a
			// request that fails the audience check still burns its nonce — a
			// deliberate change from the pre-NonceStore code, which stored the
			// nonce only after this check passed. `consume()` fuses check+store
			// into one call placed at the old check position to preserve error
			// precedence (replay is reported before audience); the trade-off is
			// audience-rejected requests can no longer retry with the same nonce.
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

			// 10. Generate token
			return {
				result: {
					status: 200,
					tokens: generateTokenResponse({
						accessToken: await generateToken(
							{},
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
