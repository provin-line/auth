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

// Boot against upstream's real outbound: its policy resolves no name at boot,
// so these show which settings let the registry be reached.

import { assemble, BootRefused, kernelConfig } from "@o3co/auth-provider-foundation/kernel";
import { quietRuntime } from "@o3co/auth-provider-foundation/kernel/testing";
import outboundModule from "@o3co/auth-provider-foundation/outbound/module";
import { describe, expect, it } from "vitest";
import registry from "../module.mjs";

async function boot(registryUrl: string, outbound: Record<string, unknown>) {
	return assemble({
		modules: [outboundModule, registry],
		config: { ...kernelConfig(), outbound, "dplaax-registry": { url: registryUrl } },
		runtime: quietRuntime({ clock: { now: () => 1_800_000_000_000 } }),
	});
}

async function refusedAt(booted: Promise<unknown>): Promise<string[]> {
	try {
		await booted;
	} catch (err) {
		if (BootRefused.is(err)) return err.refusals.map((r) => r.where);
		throw err;
	}
	throw new Error("booted");
}

describe("dplaax-registry on upstream's outbound", () => {
	it("boots for plain http to a pair outbound.plain-internal names", async () => {
		const outbound = { allow: ["registry.internal"], "plain-internal": ["registry.internal:8443"] };
		await expect(boot("http://registry.internal:8443", outbound)).resolves.toBeDefined();
	});

	it("boots for https to a host outbound.internal-hosts lists", async () => {
		const outbound = { allow: ["registry.internal"], "internal-hosts": ["registry.internal"] };
		await expect(boot("https://registry.internal", outbound)).resolves.toBeDefined();
	});

	it("refuses plain http that no plain-internal pair names", async () => {
		expect(await refusedAt(boot("http://registry.internal:8443", { allow: ["registry.internal"] }))).toEqual([
			"dplaax-registry.url",
		]);
	});

	it("refuses a host outbound.allow leaves out", async () => {
		expect(await refusedAt(boot("https://registry.example", { allow: ["other.example"] }))).toEqual([
			"dplaax-registry.url",
		]);
	});
});
