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

import { createHash } from "node:crypto";
import { assemble, BootRefused, defineModule, isUnavailable, kernelConfig } from "@o3co/auth-provider-foundation/kernel";
import { quietRuntime } from "@o3co/auth-provider-foundation/kernel/testing";
import {
	DestinationRefused,
	type Narrower,
	type OutboundRequest,
	type OutboundResponse,
	OutboundUnavailable,
	outbound,
} from "@o3co/auth-provider-foundation/outbound";
import { outboundRefusals } from "@o3co/auth-provider-foundation/outbound-policy";
import { didDocuments } from "@provin-line/auth-did-grant";
import { beforeEach, describe, expect, it } from "vitest";
import registry from "../module.mjs";

const now = 1_800_000_000_000;
const runtime = quietRuntime({ clock: { now: () => now } });
const url = "https://registry.example";
const owner = "did:dplaax:registry.example:org:acme";
/** How the outbound below explains a host its policy refuses. */
const notAllowed = "not-allowed: name the host in outbound.allow, or set outbound.allow-any-public";

const sent: { url: string; request: OutboundRequest | undefined; narrower: Narrower | undefined }[] = [];
/** The narrowers the destination policy was asked about at boot. */
const checked: (Narrower | undefined)[] = [];
let answer: (to: string) => Promise<OutboundResponse> = async () => json({ id: owner });
beforeEach(() => {
	sent.length = 0;
	checked.length = 0;
	answer = async () => json({ id: owner });
});

function bytesOf(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function json(document: unknown, status = 200): OutboundResponse {
	return { status, headers: new Map([["content-type", "application/json"]]), body: bytesOf(JSON.stringify(document)) };
}

/** An outbound that keeps each request, answers as the test says, and refuses one host by its policy. */
const outboundAnswering = defineModule({ name: "outbound" }, (m) => [
	m.provide(outbound).by(() => ({
		fetch: async (to: string, request?: OutboundRequest, narrower?: Narrower) => {
			sent.push({ url: to, request, narrower });
			return answer(to);
		},
	})),
	m.provide(outboundRefusals).by(() => ({
		explained: (to: string, narrower?: Narrower) => {
			checked.push(narrower);
			return new URL(to).hostname === "refused.example" ? notAllowed : undefined;
		},
	})),
]);

async function resolver(section: Record<string, unknown> = { url }) {
	const app = await assemble({
		modules: [outboundAnswering, registry],
		config: { ...kernelConfig(), "dplaax-registry": section },
		runtime,
	});
	return app.get(didDocuments);
}

async function refusedAt(boot: Promise<unknown>): Promise<string[]> {
	try {
		await boot;
	} catch (err) {
		if (BootRefused.is(err)) return err.refusals.map((r) => r.where);
		throw err;
	}
	throw new Error("booted");
}

describe("dplaax-registry resolution", () => {
	it("fetches an owner DID's document through outbound, as the operator's own URL, within the section's bounds", async () => {
		const documents = await resolver();
		const served = JSON.stringify({ id: owner, verificationMethod: [] });
		answer = async () => ({ status: 200, headers: new Map(), body: bytesOf(served) });
		const resolved = await documents.resolve(owner);
		expect(sent).toEqual([
			{
				url: `${url}/did/org/acme/did.json`,
				request: { method: "GET", headers: { accept: "application/did+json, application/json" } },
				narrower: { internal: url, timeoutMs: 5000, maxBytes: 65_536 },
			},
		]);
		const digest = `sha256:${createHash("sha256").update(served).digest("hex")}`;
		expect(resolved).toEqual({
			kind: "resolved",
			resolution: {
				document: { id: owner, verificationMethod: [] },
				canonicalBytes: bytesOf(served),
				digest,
				requestedDid: owner,
				finalOrigin: url,
				snapshotRef: `registry:${url}#${digest}`,
				retrievedAt: new Date(now).toISOString(),
			},
		});
	});

	it("keeps a path the URL carries, without its trailing slash", async () => {
		const documents = await resolver({ url: `${url}/registry/` });
		await documents.resolve(owner);
		expect(sent[0]?.url).toBe(`${url}/registry/did/org/acme/did.json`);
	});

	it("narrows outbound by the section's timeout and maximum document size", async () => {
		const documents = await resolver({ url, timeout: "2s", "max-document-size": "8KiB" });
		await documents.resolve(owner);
		expect(sent[0]?.narrower).toEqual({ internal: url, timeoutMs: 2000, maxBytes: 8192 });
	});

	it.each([
		["a malformed DID", "did:web:example.com"],
		["a DID that is not an owner's", `${owner}:pipeline:p1`],
		["a DID of another registry", "did:dplaax:other.example:org:acme"],
	])("rejects %s before asking the registry, with a reason free of quotes", async (_, did) => {
		const documents = await resolver();
		const resolved = await documents.resolve(did);
		expect(resolved).toMatchObject({ kind: "rejected" });
		if (resolved.kind === "rejected") expect(resolved.reason).not.toContain('"');
		expect(sent).toEqual([]);
	});

	it("matches the URL's own host in any case", async () => {
		const upper = "did:dplaax:Registry.Example:org:acme";
		answer = async () => json({ id: upper });
		await expect((await resolver()).resolve(upper)).resolves.toMatchObject({ kind: "resolved" });
	});

	it("still takes the URL's own host when allowed-registries names others", async () => {
		const documents = await resolver({ url, "allowed-registries": ["legacy.example"] });
		await expect(documents.resolve(owner)).resolves.toMatchObject({ kind: "resolved" });
	});

	it("resolves an account type other than org", async () => {
		const user = "did:dplaax:registry.example:user:alice";
		answer = async () => json({ id: user });
		await expect((await resolver()).resolve(user)).resolves.toMatchObject({ kind: "resolved" });
		expect(sent[0]?.url).toBe(`${url}/did/user/alice/did.json`);
	});

	it.each([
		["a segment with a separator", "did:dplaax:registry.example:org:a%2Fb"],
		["a dot-only segment", "did:dplaax:registry.example:org:.."],
		["a segment with a query", "did:dplaax:registry.example:org:a?x=1"],
	])("refuses %s before building any URL", async (_, did) => {
		await expect((await resolver()).resolve(did)).resolves.toMatchObject({ kind: "rejected" });
		expect(sent).toEqual([]);
	});

	it("takes a DID under a registry name allowed-registries lists, in any case", async () => {
		const legacy = "did:dplaax:Legacy.Example:org:acme";
		answer = async () => json({ id: legacy });
		const documents = await resolver({ url, "allowed-registries": ["legacy.example"] });
		await expect(documents.resolve(legacy)).resolves.toMatchObject({ kind: "resolved" });
	});

	it.each([404, 410, 400])("rejects a DID the registry answers %i for", async (status) => {
		answer = async () => json({ error: "no" }, status);
		const documents = await resolver();
		await expect(documents.resolve(owner)).resolves.toMatchObject({ kind: "rejected" });
	});

	it.each([500, 503])("throws Unavailable when the registry answers %i", async (status) => {
		answer = async () => json({ error: "down" }, status);
		const documents = await resolver();
		await expect(documents.resolve(owner)).rejects.toSatisfy(isUnavailable);
	});

	it("throws Unavailable when outbound has no usable answer in time", async () => {
		answer = async () => {
			throw new OutboundUnavailable("timeout");
		};
		const documents = await resolver();
		await expect(documents.resolve(owner)).rejects.toSatisfy(isUnavailable);
	});

	it("throws Unavailable when outbound refuses the destination, such as a redirect", async () => {
		answer = async () => {
			throw new DestinationRefused("redirect");
		};
		const documents = await resolver();
		await expect(documents.resolve(owner)).rejects.toSatisfy(isUnavailable);
	});

	it("throws Unavailable for an answer outbound stops as too large, whose status it never read", async () => {
		// outbound reads the body before it answers, so a 503 with a large body
		// arrives as too-large too: not a fact about the DID.
		answer = async () => {
			throw new OutboundUnavailable("too-large");
		};
		const documents = await resolver();
		await expect(documents.resolve(owner)).rejects.toSatisfy(isUnavailable);
	});

	it("keeps a byte order mark in the bytes and the digest, and parses the document after it", async () => {
		const served = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf(JSON.stringify({ id: owner }))]);
		answer = async () => ({ status: 200, headers: new Map(), body: served });
		const resolved = await (await resolver()).resolve(owner);
		if (resolved.kind !== "resolved") throw new Error(JSON.stringify(resolved));
		expect(resolved.resolution.canonicalBytes).toEqual(served);
		expect(resolved.resolution.digest).toBe(`sha256:${createHash("sha256").update(served).digest("hex")}`);
		expect(resolved.resolution.document).toEqual({ id: owner });
	});

	it("rejects a document whose bytes are not UTF-8", async () => {
		const served = new Uint8Array([...bytesOf(`{"id":"${owner}","x":"`), 0xff, ...bytesOf('"}')]);
		answer = async () => ({ status: 200, headers: new Map(), body: served });
		await expect((await resolver()).resolve(owner)).resolves.toMatchObject({ kind: "rejected" });
	});

	it.each([
		["holds a duplicate key", `{"id":"${owner}","id":"${owner}"}`],
		["is no object", "[]"],
		["has no string id", '{"id":7}'],
		["names another DID", '{"id":"did:dplaax:registry.example:org:other"}'],
	])("rejects a document that %s", async (_, text) => {
		answer = async () => ({ status: 200, headers: new Map(), body: bytesOf(text) });
		const documents = await resolver();
		await expect(documents.resolve(owner)).resolves.toMatchObject({ kind: "rejected" });
	});
});

describe("dplaax-registry boot", () => {
	it("refuses a URL outbound's destination policy refuses, at the url key", async () => {
		expect(await refusedAt(resolver({ url: "https://refused.example" }))).toEqual(["dplaax-registry.url"]);
	});

	it("asks the destination policy about the URL as the operator's own", async () => {
		await resolver();
		expect(checked).toEqual([{ internal: url }]);
	});

	it("refuses an allowed-registries name no DID can carry", async () => {
		expect(await refusedAt(resolver({ url, "allowed-registries": ["bad/name"] }))).toEqual([
			expect.stringContaining("allowed-registries"),
		]);
	});

	it("refuses a section without url", async () => {
		expect(await refusedAt(resolver({}))).toEqual([expect.stringContaining("dplaax-registry")]);
	});

	it("refuses a URL that is neither https nor http", async () => {
		expect(await refusedAt(resolver({ url: "ftp://registry.example" }))).toEqual([
			expect.stringContaining("dplaax-registry"),
		]);
	});
});
