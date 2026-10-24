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

// Composes the DID grant the way the token endpoint runs it, on upstream's
// test parts: `grantCaller` in place of the endpoint, the tokens stand-in,
// and stand-ins for the two contracts this package owns.

import http from "@o3co/auth-provider-foundation/http/module";
import { httpConfig } from "@o3co/auth-provider-foundation/http/testing";
import {
	assemble,
	contract,
	defineModule,
	kernelConfig,
	type Module,
	Unavailable,
} from "@o3co/auth-provider-foundation/kernel";
import { quietRuntime } from "@o3co/auth-provider-foundation/kernel/testing";
import secretHashModule from "@o3co/auth-provider-foundation/secret-hash/module";
import { clients } from "@o3co/auth-provider-identity/clients";
import clientsModule from "@o3co/auth-provider-identity/clients/module";
import { clientsConfig, publicClient } from "@o3co/auth-provider-identity/clients/testing";
import clientAllowanceModule from "@o3co/auth-provider-oauth/client-allowance/module";
import { allowancesFor } from "@o3co/auth-provider-oauth/client-allowance/testing";
import issuerModule from "@o3co/auth-provider-oauth/issuer/module";
import { issuerConfig } from "@o3co/auth-provider-oauth/issuer/testing";
import { tokenEndpointLocation } from "@o3co/auth-provider-oauth/token-endpoint";
import { type Grant, grants } from "@o3co/auth-provider-oauth/grants";
import { grantCaller, grantCalls, grantInput } from "@o3co/auth-provider-oauth/token-endpoint/testing";
import { tokens } from "@o3co/auth-provider-oauth/tokens";
import { tokensStandIn } from "@o3co/auth-provider-oauth/tokens/testing";
import { type DidDocuments, didDocuments, type Resolution, spentNonces } from "../contract.mjs";
import didGrant from "../module.mjs";

export const DID_GRANT_TYPE = "https://dplaax.dev/oauth/grant-type/did";
export const ISSUER = "https://as.example";
export const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`;
export const AUDIENCE = "https://rs.example";

export const now = 1_800_000_000_000;
/** The kernel's time, which a test may move and must put back. */
export const clock = { at: now };

/** What the stand-in resolver answers for one DID. */
export type Answer = { kind: "resolved"; resolution: Resolution } | { kind: "rejected"; reason: string } | "unavailable";

export interface Stands {
	/** The resolver's answers by DID; a DID not listed is rejected. */
	answers: Map<string, Answer>;
	/** Names the nonce store holds, with their expiry on the kernel clock. */
	spent: Map<string, number>;
	/** When set, the nonce store cannot tell. */
	nonceStoreDown: boolean;
}

export function stands(): Stands {
	return { answers: new Map(), spent: new Map(), nonceStoreDown: false };
}

function standInModules(s: Stands): Module[] {
	const resolver: DidDocuments = {
		async resolve(did) {
			const answer = s.answers.get(did);
			if (answer === "unavailable") throw new Unavailable("did documents");
			return answer ?? { kind: "rejected", reason: `DID not found: ${did}` };
		},
	};
	return [
		defineModule({ name: "did-documents-stand-in" }, (m) => [m.provide(didDocuments).by(() => resolver)]),
		defineModule({ name: "spent-nonces-stand-in" }, (m) => [
			m.provide(spentNonces).by(() => ({
				async save(name: string, lifetimeMs: number) {
					if (s.nonceStoreDown) throw new Unavailable("spent nonces");
					const expires = s.spent.get(name);
					if (expires !== undefined && expires > clock.at) return "exists" as const;
					s.spent.set(name, clock.at + lifetimeMs);
					return "created" as const;
				},
			})),
		]),
	];
}

export interface ComposeOptions {
	/** The `did-grant` section; a minimal LEGACY one when left out. */
	section?: Record<string, unknown>;
	/** The client "app"'s allowances. */
	allowances?: Parameters<typeof allowancesFor>[0];
	/** The token endpoint's location; null for a deployment without a public origin. */
	location?: string | null;
	/** Modules added after the DID grant. */
	extra?: readonly Module[];
	stands?: Stands;
}

/** The DID grant as composed, so a test can hand it a request the caller does not build. */
const composedDidGrant = contract<Grant | undefined>("test.did-grant");
const didGrantProbe = defineModule({ name: "did-grant-probe" }, (m) => [
	m.provide(composedDidGrant).by(async (c) => (await c.collect(grants)).find((g) => g.grantType === DID_GRANT_TYPE)),
]);

export const minimalSection = {
	"revocation-latency-bound": "15m",
	"access-token-lifetime": "10m",
};

export async function compose(options: ComposeOptions = {}) {
	const s = options.stands ?? stands();
	const located = options.location === undefined ? TOKEN_ENDPOINT : options.location;
	const location = defineModule({ name: "token-endpoint-location" }, (m) => [
		m.provide(tokenEndpointLocation).by(() => ({ url: located ?? undefined })),
	]);
	const app = await assemble({
		modules: [
			location,
			http,
			tokensStandIn(),
			issuerModule,
			clientsModule,
			secretHashModule,
			grantCaller,
			clientAllowanceModule,
			...standInModules(s),
			didGrant,
			didGrantProbe,
			...(options.extra ?? []),
		],
		config: {
			...kernelConfig(),
			...httpConfig(),
			...issuerConfig({ url: ISSUER }),
			...clientsConfig([
				publicClient({
					id: "app",
					sections: allowancesFor(
						options.allowances ?? {
							grants: [DID_GRANT_TYPE],
							scopes: ["read"],
							"default-scopes": [],
							audiences: [AUDIENCE],
						},
					),
				}),
			]),
			"did-grant": options.section ?? minimalSection,
		},
		runtime: quietRuntime({
			clock: { now: () => clock.at },
			random: { bytes: (n) => new Uint8Array(n).fill(7) },
		}),
	});
	return {
		app,
		stands: s,
		/** Calls the DID grant as the token endpoint would for the client "app". */
		call: (params: Record<string, unknown>) =>
			app.get(grantCalls).call(DID_GRANT_TYPE, "app", { grant_type: DID_GRANT_TYPE, ...params }),
		/** Calls the DID grant with the parameters in a JSON body, which the caller never sends. */
		callJson: async (params: Record<string, unknown>) => {
			const grant = app.get(composedDidGrant);
			const client = await app.get(clients).find("app");
			if (!grant || !client) throw new Error("no DID grant or client app");
			const asJson: Grant = { ...grant, bodies: ["json"] };
			return grant.handle(grantInput(app.get(tokens), asJson, client, { grant_type: DID_GRANT_TYPE, ...params }));
		},
		verify: (token: string) => app.get(tokens).verifyAccess(token),
	};
}
