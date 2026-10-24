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

import { defineModule, type Refusal, setting } from "@o3co/auth-provider-foundation/kernel";
import { grants } from "@o3co/auth-provider-oauth/grants";
import { issuer } from "@o3co/auth-provider-oauth/issuer";
import { tokenEndpointLocation } from "@o3co/auth-provider-oauth/token-endpoint";
import { z } from "zod";
import { didDocuments, signatureAlgorithms, spentNonces } from "./contract.mjs";
import { didGrant } from "./grant.mjs";
import { BUILTIN_ALGORITHMS, type VerifierFactory } from "./verifiers/factory.mjs";

/** The P0 auth contracts (dplaax.spec). Kept in step with `AuthContractId` in transcript.mts. */
const authContracts = [
	"LEGACY_DID_LOGIN@1",
	"OWNER_AUTHENTICATION_LOGIN@1",
	"OWNER_ASSERTION_CONTROL_LOGIN@1",
] as const;

const isOwner = (contract: (typeof authContracts)[number]) => contract !== "LEGACY_DID_LOGIN@1";

/**
 * Algorithms whose signed envelope carries a JWS protected header, the only
 * place a `kid` can come from. An OWNER contract's three-way kid match (rule
 * `auth.grant.kid-match`) cannot hold without one, so an OWNER contract takes
 * these alone.
 */
const HEADER_BEARING_ALGORITHMS: ReadonlySet<string> = new Set(["ed25519_jws", "es256_jws", "es256k_jws"]);

/** A whole number of seconds, from `1s` to `1d`. */
const seconds = () => setting.duration("s").pipe(z.number().int().min(1).max(86_400));

const section = z
	.strictObject({
		"supported-algorithms": z
			.array(z.string().min(1))
			.min(1)
			.prefault(["ed25519_raw"])
			.describe("The signature algorithms a request may use: built in, or contributed at `signatureAlgorithms`."),
		"message-max-age": seconds()
			.prefault("5m")
			.describe("How far a signed message's timestamp may be from this host's clock, from `1s` to `1d`."),
		"auth-contract": z
			.enum(authContracts)
			.prefault("LEGACY_DID_LOGIN@1")
			.describe("The auth contract the grant enforces (dplaax.spec)."),
		"owner-migration-ratified": z
			.boolean()
			.prefault(false)
			.describe("The operator's opt-in an OWNER contract requires (rule `auth.migration.enable-gate`)."),
		"revocation-latency-bound": seconds().describe(
			"Required. The longest an access token may outlive a revocation (rule `auth.token.lifetime-bound`).",
		),
		"legacy-max-ttl": seconds()
			.prefault("15m")
			.describe("The longest lifetime of a `LEGACY_DID_LOGIN@1` token (rule `auth.legacy.did-login`)."),
		"access-token-lifetime": seconds().describe(
			"Required. The lifetime of the access tokens this grant issues, from `1s` to `1d`.",
		),
	})
	.superRefine((s, ctx) => {
		const lifetime = s["access-token-lifetime"];
		if (lifetime > s["revocation-latency-bound"]) {
			ctx.addIssue({
				code: "custom",
				path: ["access-token-lifetime"],
				message: `exceeds revocation-latency-bound (${s["revocation-latency-bound"]}s), rule auth.token.lifetime-bound`,
			});
		}
		if (s["auth-contract"] === "LEGACY_DID_LOGIN@1" && lifetime > s["legacy-max-ttl"]) {
			ctx.addIssue({
				code: "custom",
				path: ["access-token-lifetime"],
				message: `exceeds legacy-max-ttl (${s["legacy-max-ttl"]}s) for LEGACY_DID_LOGIN@1, rule auth.legacy.did-login`,
			});
		}
		if (isOwner(s["auth-contract"]) && !s["owner-migration-ratified"]) {
			ctx.addIssue({
				code: "custom",
				path: ["owner-migration-ratified"],
				message: "an OWNER contract requires it true, rule auth.migration.enable-gate",
			});
		}
	});

export default defineModule({ name: "did-grant", section }, (m) => [
	m.contribute(grants).by(async (c) => {
		const s = c.section;
		const owner = isOwner(s["auth-contract"]);
		const refused: Refusal[] = [];

		const algorithms = new Map<string, VerifierFactory>(BUILTIN_ALGORITHMS);
		for (const contributed of await c.collect(signatureAlgorithms)) {
			if (BUILTIN_ALGORITHMS.has(contributed.algorithm)) {
				refused.push({
					where: "did-grant",
					reason: `a contributed signature algorithm takes the built-in name "${contributed.algorithm}"`,
				});
				continue;
			}
			algorithms.set(contributed.algorithm, () => contributed.create());
		}
		for (const [at, name] of s["supported-algorithms"].entries()) {
			const where = `did-grant.supported-algorithms.${at}`;
			if (!algorithms.has(name)) {
				refused.push({ where, reason: "is neither built in nor contributed at signatureAlgorithms" });
			} else if (owner && !HEADER_BEARING_ALGORITHMS.has(name)) {
				refused.push({
					where,
					reason: `has no JWS protected header, which ${s["auth-contract"]} needs (rule auth.grant.kid-match)`,
				});
			}
		}

		const { url: tokenEndpoint } = await c.get(tokenEndpointLocation);
		if (owner && tokenEndpoint === undefined) {
			refused.push({
				where: "did-grant",
				reason: `${s["auth-contract"]} checks the transcript's token_endpoint, and the token endpoint's location needs a public origin`,
			});
		}
		if (refused.length > 0) return c.refuseAll(refused);

		return didGrant(
			{
				authContract: s["auth-contract"],
				supportedAlgorithms: s["supported-algorithms"],
				messageMaxAgeMs: s["message-max-age"] * 1000,
				accessTokenLifetimeSeconds: s["access-token-lifetime"],
				issuer: (await c.get(issuer)).url,
			},
			{
				documents: await c.get(didDocuments),
				nonces: await c.get(spentNonces),
				algorithms,
				now: () => c.clock.now(),
			},
		);
	}),
]);
