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

// The provider the way a generated app composes it: auth.provider's modules,
// the DID grant, the dPLaaX registry and the nonce store, serving the token
// endpoint over HTTP and signing HS256 with a secret read as UTF-8, which is
// how the policy-verifier reads the same string.

import auditModule from "@o3co/auth-provider-foundation/audit/module";
import { auditConfig } from "@o3co/auth-provider-foundation/audit/testing";
import { listening } from "@o3co/auth-provider-foundation/http";
import httpModule from "@o3co/auth-provider-foundation/http/module";
import { httpConfig } from "@o3co/auth-provider-foundation/http/testing";
import keysModule from "@o3co/auth-provider-foundation/keys/module";
import { keysConfig } from "@o3co/auth-provider-foundation/keys/testing";
import { assemble, kernelConfig } from "@o3co/auth-provider-foundation/kernel";
import { quietRuntime, recordingLog } from "@o3co/auth-provider-foundation/kernel/testing";
import outboundModule from "@o3co/auth-provider-foundation/outbound/module";
import rateLimitModule from "@o3co/auth-provider-foundation/rate-limit/module";
import secretHashModule from "@o3co/auth-provider-foundation/secret-hash/module";
import storeModule from "@o3co/auth-provider-foundation/store/module";
import { storeConfig } from "@o3co/auth-provider-foundation/store/testing";
import clientsModule from "@o3co/auth-provider-identity/clients/module";
import { clientsConfig, confidentialClient, publicClient } from "@o3co/auth-provider-identity/clients/testing";
import clientAllowanceModule from "@o3co/auth-provider-oauth/client-allowance/module";
import { allowancesFor } from "@o3co/auth-provider-oauth/client-allowance/testing";
import issuerModule from "@o3co/auth-provider-oauth/issuer/module";
import { issuerConfig } from "@o3co/auth-provider-oauth/issuer/testing";
import senderBindingModule from "@o3co/auth-provider-oauth/sender-binding/module";
import tokenControlModule from "@o3co/auth-provider-oauth/token-control/module";
import tokenEndpointModule from "@o3co/auth-provider-oauth/token-endpoint/module";
import tokensModule from "@o3co/auth-provider-oauth/tokens/module";
import { tokensConfig } from "@o3co/auth-provider-oauth/tokens/testing";
import tokensStoreModule from "@o3co/auth-provider-templates/tokens-store/module";
import didGrant from "@provin-line/auth-did-grant/module";
import didGrantStore from "@provin-line/auth-did-grant-store/module";
import dplaaxRegistry from "@provin-line/auth-dplaax-registry/module";

export const JWT_SECRET = "integration.test.secret.at.least.32.bytes.long";
export const JWT_ISSUER = "https://issuer.test.invalid";
export const JWT_AUDIENCE = "https://policy-verifier.test.local";
export const JWT_KID = "test-key";

/** The public client the DID grant is requested by. */
export const DID_CLIENT_ID = "dplaax-test-public-client";
/** A confidential client, which may introspect tokens (a public one may not). */
export const INTROSPECTION_CLIENT_ID = "dplaax-test-introspection-client";

/** The registry name the test DIDs carry; the registry itself is served on loopback. */
export const REGISTRY_NAME = "registry.test.local";

export interface ProviderOptions {
	/** Where the registry listens on 127.0.0.1. */
	readonly registryPort: number;
	/** The grant type to allow the DID client, from the grant's contract. */
	readonly didGrantType: string;
	readonly random?: (length: number) => Uint8Array;
}

export async function startProvider(options: ProviderOptions) {
	const log = recordingLog();
	const app = await assemble({
		modules: [
			tokenEndpointModule,
			tokenControlModule,
			clientAllowanceModule,
			outboundModule,
			auditModule,
			clientsModule,
			httpModule,
			issuerModule,
			rateLimitModule,
			senderBindingModule,
			tokensModule,
			secretHashModule,
			storeModule,
			keysModule,
			tokensStoreModule,
			didGrant,
			dplaaxRegistry,
			didGrantStore,
		],
		config: {
			...kernelConfig(),
			...httpConfig({ "public-origin": JWT_ISSUER }),
			...issuerConfig({ url: JWT_ISSUER }),
			...storeConfig(),
			...auditConfig({ receivers: ["log"] }),
			...keysConfig({
				signing: { kid: JWT_KID, alg: "HS256", secret: JWT_SECRET, "secret-encoding": "utf8" },
			}),
			...tokensConfig({ revocation: "denylist" }),
			...clientsConfig([
				publicClient({
					id: DID_CLIENT_ID,
					sections: allowancesFor({
						grants: [options.didGrantType],
						scopes: [],
						"default-scopes": [],
						audiences: [JWT_AUDIENCE],
					}),
				}),
				confidentialClient({
					id: INTROSPECTION_CLIENT_ID,
					sections: allowancesFor({
						grants: [],
						scopes: [],
						"default-scopes": [],
						audiences: [JWT_AUDIENCE],
					}),
				}),
			]),
			outbound: {
				allow: ["127.0.0.1"],
				"plain-loopback": [`127.0.0.1:${options.registryPort}`],
			},
			"dplaax-registry": {
				url: `http://127.0.0.1:${options.registryPort}`,
				"allowed-registries": [REGISTRY_NAME],
			},
			"did-grant": {
				"message-max-age": "5m",
				"revocation-latency-bound": "1h",
				"legacy-max-ttl": "1h",
				"access-token-lifetime": "1h",
			},
		},
		runtime: quietRuntime(
			options.random ? { log: log.log, random: { bytes: options.random } } : { log: log.log },
		),
	});
	await app.start();
	return {
		app,
		log,
		url: (path: string) => `http://127.0.0.1:${app.get(listening).port()}${path}`,
		stop: () => app.stop(),
	};
}
