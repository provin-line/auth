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


import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// auth.provider's generator reads config.example as the module's fragment:
// the example of its own section, from which it writes the app's bindings.
const text = await readFile(join(import.meta.dirname, "..", "..", "config.example"), "utf8");

describe("config.example", () => {
	it("holds the did-grant section alone, as the generator takes one section per fragment", () => {
		const sections = text
			.split("\n")
			.filter((line) => /^[^\s}#]/.test(line))
			.map((line) => line.replace(/\s*\{\s*$/, ""));
		expect(sections).toEqual(["did-grant"]);
	});

	it("names the required revocation-latency-bound", () => {
		expect(text).toMatch(/^\trevocation-latency-bound = /m);
	});
});
