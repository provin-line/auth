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

import { defineModule, setting } from "@o3co/auth-provider-foundation/kernel";
import { outbound } from "@o3co/auth-provider-foundation/outbound";
import { destinationRefusal, outboundRefusals } from "@o3co/auth-provider-foundation/outbound-policy";
import { urlSetting } from "@o3co/auth-provider-foundation/url-setting";
import { didDocuments } from "@provin-line/auth-did-grant";
import { z } from "zod";
import { registryResolver } from "./resolver.mjs";

const section = z.strictObject({
	url: urlSetting({ schemes: ["https", "http"], query: false }).describe(
		"Required. The DID registry's base URL. outbound's destination policy decides how it is reached: https to a host outbound.allow names (at a private address, one outbound.internal-hosts lists), or plain http to a pair outbound.plain-internal names.",
	),
	"allowed-registries": z
		// The grammar of a did:dplaax registry segment: a name no DID can carry is refused.
		.array(z.string().regex(/^[A-Za-z0-9._-]+$/).refine((name) => !/^\.+$/.test(name), "a dot-only name"))
		.prefault([])
		.describe("Registry names a DID may carry beyond url's host, for DIDs kept under an earlier registry's name."),
	timeout: setting
		.duration("ms")
		.pipe(z.number().int().min(1).max(60_000))
		.prefault("5s")
		.describe("How long a resolution may take, from 1ms to 1m; outbound's own timeout still applies."),
	"max-document-size": setting
		.size("B")
		.pipe(z.number().int().min(1).max(16 * 1024 * 1024))
		.prefault("64KiB")
		.describe("The largest document taken, from 1B to 16MiB; outbound's own max-response-size still applies."),
});

export default defineModule({ name: "dplaax-registry", section, replicaSafe: true }, (m) => [
	m.provide(didDocuments).by(async (c) => {
		const { url } = c.section;
		// The operator's own URL: a registry at a private address is reached at its
		// origin, for a host in internal-hosts or a plain-internal pair.
		const narrower = { internal: url, timeoutMs: c.section.timeout, maxBytes: c.section["max-document-size"] };
		const refused = destinationRefusal(await c.get(outboundRefusals), url, { internal: url });
		if (refused !== undefined) return c.refuse("dplaax-registry.url", refused);
		return registryResolver({
			url,
			allowedRegistries: c.section["allowed-registries"],
			narrower,
			outbound: await c.get(outbound),
			now: () => c.clock.now(),
		});
	}),
]);
