/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from "vitest";
import { composedMismatches } from "../composed.mjs";
import type { ProvinPackage } from "../provin-modules.mjs";

const packages: readonly ProvinPackage[] = [
	{ name: "@provin-line/auth-did-grant", version: "0.6.0", role: "module" },
	{ name: "@provin-line/did-dplaax", version: "0.6.0", role: "dependency" },
];

const outside = (version: string) =>
	JSON.stringify({ modules: [{ name: "@provin-line/auth-did-grant", version, integrity: "sha512-x" }] });

const lockfile = (...versions: string[]) =>
	[
		"lockfileVersion: '9.0'",
		"",
		"packages:",
		"",
		...versions.flatMap((v) => [`  '@provin-line/did-dplaax@${v}':`, "    resolution: {integrity: sha512-y}", ""]),
		"snapshots:",
		"",
		...versions.flatMap((v) => [`  '@provin-line/did-dplaax@${v}': {}`, ""]),
	].join("\n");

describe("composedMismatches", () => {
	it("finds none where every package is composed at the release's version", () => {
		expect(composedMismatches(outside("0.6.0"), lockfile("0.6.0"), packages)).toEqual([]);
	});

	it("names a module composed at another version, with both versions", () => {
		expect(composedMismatches(outside("0.5.9"), lockfile("0.6.0"), packages)).toEqual([
			"@provin-line/auth-did-grant is 0.5.9, not 0.6.0",
		]);
	});

	it("names a module not composed", () => {
		expect(composedMismatches(JSON.stringify({ modules: [] }), lockfile("0.6.0"), packages)).toEqual([
			"@provin-line/auth-did-grant is not composed",
		]);
	});

	it("names a dependency the project resolved at another version", () => {
		expect(composedMismatches(outside("0.6.0"), lockfile("0.6.9"), packages)).toEqual([
			"@provin-line/did-dplaax is 0.6.9, not 0.6.0",
		]);
	});

	it("names every other version of a dependency the project resolved beside the release's", () => {
		expect(composedMismatches(outside("0.6.0"), lockfile("0.6.0", "0.5.0"), packages)).toEqual([
			"@provin-line/did-dplaax is 0.5.0, not 0.6.0",
		]);
	});

	it("names a dependency the project did not resolve", () => {
		expect(composedMismatches(outside("0.6.0"), lockfile(), packages)).toEqual([
			"@provin-line/did-dplaax is not installed",
		]);
	});
});
