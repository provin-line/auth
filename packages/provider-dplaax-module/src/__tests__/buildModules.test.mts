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
import * as ed from "@noble/ed25519";
import {
	type AppConfig,
	BootError,
	createApp,
	createInMemorySubjectRevocation,
	createInMemorySubjectSessionIndex,
	createMemoryAccessTokenDenylist,
	createSymmetricKeyStore,
	defineModule,
	type GrantContext,
	InMemoryClientRepository,
	InMemoryCodeRepository,
} from "@o3co/auth-provider-core";
import { makeValidAppConfig } from "@o3co/auth-provider-core/testing";
import type { DidDocument, DidDocumentResolver, NonceStore, ResolutionResult } from "@provin-line/auth-provider-did";
import { describe, expect, it, vi } from "vitest";
import { buildModules, type DplaaxAppConfig } from "../buildModules.mjs";
import { auditSinkModule, createAuditSinkModule } from "../modules.mjs";
import { DplaaxConfigSchema } from "../config-schema.mjs";

// The client repository is not what these tests are about; the default one
// reads a yaml file from disk.
const memoryClientRepositoryModule = defineModule({
	name: "test:memory-client-repository",
	provides: { clientRepository: () => new InMemoryClientRepository(new Map()) },
});

const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";

function makeConfig(): DplaaxAppConfig {
	const base = makeValidAppConfig();
	return {
		...base,
		// Core's fixture declares the audit sink absent ("none"); this
		// composition always wires one, so it selects the built-in sink.
		audit: { sink: { type: "console" } },
		oauth: {
			...base.oauth,
			// Task 8 (auth-provider-did): `oauth.grants.did` is required, with
			// no object-level default — `allowedAudiences` and
			// `revocationLatencyBoundSec` are mandatory (fail closed).
			// `legacyMaxTtlSec` is raised to match `makeValidAppConfig()`'s
			// `accessToken.expiresIn` (3600s) since `authContract` defaults to
			// `LEGACY_DID_LOGIN@1` (rule auth.legacy.did-login caps legacy
			// tokens at `legacyMaxTtlSec`, default 900s).
			grants: {
				did: {
					allowedAudiences: ["https://api.example.com"],
					revocationLatencyBoundSec: 3600,
					legacyMaxTtlSec: 3600,
				},
			},
		},
		dplaax: {
			registry: { baseUrl: "https://registry.example.com", allowedRegistries: [] },
		},
	};
}

function makeMockResolution(document: DidDocument, did: string): ResolutionResult {
	const digest = `sha256:${"0".repeat(64)}`;
	return {
		document,
		canonicalBytes: new TextEncoder().encode(JSON.stringify(document)),
		digest,
		requestedDid: did,
		finalOrigin: "mock://registry",
		snapshotRef: `registry:mock://registry#${digest}`,
		retrievedAt: new Date().toISOString(),
	};
}

function buildResolver(did: string, publicKeyBytes: Uint8Array): DidDocumentResolver {
	const x = Buffer.from(publicKeyBytes).toString("base64url");
	const didDoc: DidDocument = {
		id: did,
		verificationMethod: [
			{
				id: `${did}#key-1`,
				type: "JsonWebKey2020",
				controller: did,
				publicKeyJwk: { kty: "OKP", crv: "Ed25519", x },
			},
		],
	};
	return {
		async resolve(d: string): Promise<ResolutionResult> {
			if (d === did) return makeMockResolution(didDoc, did);
			throw new Error(`DID not found: ${d}`);
		},
	};
}

async function makeSignedCtx(did: string): Promise<{ ctx: GrantContext; resolver: DidDocumentResolver }> {
	const privateKey = ed.utils.randomSecretKey();
	const publicKey = await ed.getPublicKeyAsync(privateKey);

	const message = JSON.stringify({
		did,
		timestamp: new Date().toISOString(),
		nonce: `nonce-${Date.now()}-${Math.random()}`,
	});
	const messageBytes = new TextEncoder().encode(message);
	const signature = await ed.signAsync(messageBytes, privateKey);

	return {
		ctx: {
			body: {
				did,
				message,
				signature: Buffer.from(signature).toString("base64"),
			},
			session: {},
			issuer: "localhost",
			metadata: { ip: "127.0.0.1" },
			authenticatedClient: null,
		} as GrantContext,
		resolver: buildResolver(did, publicKey),
	};
}

describe("buildModules – nonceStore override", () => {
	it("threads DplaaxBuildModulesOverrides.nonceStore through to the DID grant handler", async () => {
		const { ctx, resolver } = await makeSignedCtx("did:key:z6MkBuildModulesNonce");
		const consume = vi.fn(async () => true);
		const fakeNonceStore: NonceStore = { consume };

		const modules = buildModules(makeConfig(), { didResolver: resolver, nonceStore: fakeNonceStore });
		const didModule = modules.find((m) => m.name === "oauth-did");
		expect(didModule).toBeDefined();

		// biome-ignore lint/suspicious/noExplicitAny: same escape hatch module.mts uses at the contribute boundary
		const grantFactory = (didModule?.contributes?.grants as Record<string, any> | undefined)?.[
			DID_GRANT_TYPE
		];
		expect(typeof grantFactory).toBe("function");

		const handler = grantFactory({
			config: makeConfig(),
			keyStore: createSymmetricKeyStore("test-secret"),
			pathResolver: (s: string) => s,
		});

		const { result } = await handler.handle(ctx);

		expect(result.status).toBe(200);
		expect(consume).toHaveBeenCalledTimes(1);
	});

	it("falls back to the default in-memory nonce store when no override is supplied", async () => {
		const { ctx, resolver } = await makeSignedCtx("did:key:z6MkBuildModulesDefault");

		const modules = buildModules(makeConfig(), { didResolver: resolver });
		const didModule = modules.find((m) => m.name === "oauth-did");
		// biome-ignore lint/suspicious/noExplicitAny: same escape hatch module.mts uses at the contribute boundary
		const grantFactory = (didModule?.contributes?.grants as Record<string, any> | undefined)?.[
			DID_GRANT_TYPE
		];

		const handler = grantFactory({
			config: makeConfig(),
			keyStore: createSymmetricKeyStore("test-secret"),
			pathResolver: (s: string) => s,
		});

		const { result } = await handler.handle(ctx);
		expect(result.status).toBe(200);
		handler.cleanup?.();
	});
});

describe("buildModules – security capabilities are wired", () => {
	const providers = (modules: readonly { provides?: Record<string, unknown> }[]) =>
		modules.flatMap((m) => Object.keys(m.provides ?? {}));

	it("provides an audit sink, an access-token denylist and the subject-revocation pair", () => {
		const provided = providers(buildModules(makeConfig()));
		expect(provided).toEqual(
			expect.arrayContaining([
				"auditSink",
				"accessTokenDenylist",
				"subjectRevocation",
				"subjectSessionIndex",
			]),
		);
	});

	it("marks every in-memory revocation store unsafe for multi-replica boot", () => {
		const modules = buildModules(makeConfig());
		for (const slot of ["accessTokenDenylist", "subjectRevocation"]) {
			const owner = modules.find((m) => Object.hasOwn(m.provides ?? {}, slot));
			expect(owner?.replicaSafety?.unsafe, `${slot} provider`).toBe(true);
		}
	});

	it("replaces each capability module with its override", () => {
		const auditSinkModule = defineModule({ name: "test:audit", provides: { auditSink: () => ({}) as never } });
		const accessTokenDenylistModule = defineModule({
			name: "test:denylist",
			provides: { accessTokenDenylist: () => ({}) as never },
		});
		const subjectRevocationModule = defineModule({
			name: "test:subject",
			provides: {
				subjectRevocation: () => ({}) as never,
				subjectSessionIndex: () => ({}) as never,
			},
		});
		const names = buildModules(makeConfig(), {
			auditSinkModule,
			accessTokenDenylistModule,
			subjectRevocationModule,
		}).map((m) => m.name);
		expect(names).toEqual(expect.arrayContaining(["test:audit", "test:denylist", "test:subject"]));
		expect(names).not.toContain("dplaax:audit-sink");
		expect(names).not.toContain("core-access-token-denylist-memory");
		expect(names).not.toContain("dplaax:in-memory-subject-revocation");
	});
});

describe("auditSinkModule", () => {
	const build = (config: unknown) =>
		// biome-ignore lint/suspicious/noExplicitAny: provider factory boundary
		(auditSinkModule.provides as Record<string, any>).auditSink({ config });

	it("defaults to the built-in console sink when the config has no audit section", async () => {
		const { audit: _omitted, ...withoutAudit } = makeConfig() as DplaaxAppConfig & { audit?: unknown };
		expect(withoutAudit).not.toHaveProperty("audit");
		const sink = await build(withoutAudit);
		expect(sink.kind).toBe("console");
	});

	it("builds the sink named by audit.sink.type", async () => {
		const sink = await build({ ...makeConfig(), audit: { sink: { type: "console" } } });
		expect(sink.kind).toBe("console");
	});

	it('refuses "none" — the audit trail cannot be switched off by config', async () => {
		await expect(build({ ...makeConfig(), audit: { sink: { type: "none" } } })).rejects.toThrow(/none/);
	});
});

describe("createAuditSinkModule", () => {
	const build = (module: typeof auditSinkModule, config: unknown) =>
		// biome-ignore lint/suspicious/noExplicitAny: provider factory boundary
		(module.provides as Record<string, any>).auditSink({ config });

	it("lets a deployment register its own sink and select it by audit.sink.type", async () => {
		const events: unknown[] = [];
		const module = createAuditSinkModule({
			registerSinks: (factory) =>
				factory.register("capture", (options) => ({
					kind: `capture:${String((options as { label?: string }).label)}`,
					async record(event) {
						events.push(event);
					},
				})),
		});
		const sink = await build(module, {
			...makeConfig(),
			audit: { sink: { type: "capture", capture: { label: "siem" } } },
		});
		expect(sink.kind).toBe("capture:siem");
		await sink.record({ type: "token.issued" });
		expect(events).toEqual([{ type: "token.issued" }]);
	});

	it("keeps the built-in console sink alongside registered ones", async () => {
		const module = createAuditSinkModule({ registerSinks: () => {} });
		const sink = await build(module, { ...makeConfig(), audit: { sink: { type: "console" } } });
		expect(sink.kind).toBe("console");
	});
});

describe("buildModules – multi-replica refusal is enforced end to end", () => {
	const bootstrap = (config: unknown) => ({
		config: config as AppConfig,
		pathResolver: (s: string) => s,
	});

	it("DplaaxConfigSchema keeps deployment.mode instead of stripping it", () => {
		const slice = DplaaxConfigSchema.pick({ deployment: true });
		expect(slice.parse({ deployment: { mode: "multi" } })).toEqual({ deployment: { mode: "multi" } });
		expect(() => slice.parse({ deployment: { mode: "cluster" } })).toThrow();
	});

	it("refuses to boot in multi mode while any in-process store is wired", async () => {
		const config = { ...makeConfig(), deployment: { mode: "multi" } };
		const error = await createApp({
			modules: buildModules(config as DplaaxAppConfig, {
				clientRepositoryModule: memoryClientRepositoryModule,
			}),
			bootstrapComponents: bootstrap(config),
		}).then(
			() => undefined,
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(BootError);
		const details = (error as BootError).details as { reason: string };
		expect(details.reason).toBe("replica-unsafe-adapter");
		for (const name of [
			"dplaax:in-memory-code-repository",
			"core-access-token-denylist-memory",
			"dplaax:in-memory-subject-revocation",
			"oauth-did",
		]) {
			expect((error as Error).message).toContain(name);
		}
	});

	it("boots in multi mode once every in-process store is replaced by a shared one", async () => {
		const config = { ...makeConfig(), deployment: { mode: "multi" } };
		const shared = (name: string, slots: Record<string, () => unknown>) =>
			defineModule({ name, provides: slots as never });
		const handle = await createApp({
			modules: buildModules(config as DplaaxAppConfig, {
				clientRepositoryModule: memoryClientRepositoryModule,
				codeRepositoryModule: shared("test:shared-code", {
					codeRepository: () => new InMemoryCodeRepository(),
				}),
				accessTokenDenylistModule: shared("test:shared-denylist", {
					accessTokenDenylist: () => createMemoryAccessTokenDenylist(),
				}),
				subjectRevocationModule: shared("test:shared-subject", {
					subjectRevocation: () => createInMemorySubjectRevocation(),
					subjectSessionIndex: () => createInMemorySubjectSessionIndex(),
				}),
				nonceStore: { consume: async () => true },
			}),
			bootstrapComponents: bootstrap(config),
		});
		await handle.dispose();
	});
});
