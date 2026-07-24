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
import { describe, expect, it } from "vitest";
import { StrictJsonError, strictJsonParse } from "../../resolver/strictJson.mjs";

describe("strictJsonParse", () => {
	it("rejects duplicate object keys at any depth", () => {
		expect(() => strictJsonParse(`{"a":1,"a":2}`)).toThrow(StrictJsonError);
		expect(() => strictJsonParse(`{"o":{"x":1,"x":2}}`)).toThrow(StrictJsonError);
	});

	it("rejects trailing data", () => {
		expect(() => strictJsonParse(`{"a":1} garbage`)).toThrow(StrictJsonError);
	});

	it("preserves unknown members", () => {
		expect(strictJsonParse(`{"id":"d","futureMember":[1]}`)).toEqual({ id: "d", futureMember: [1] });
	});

	it("tags duplicate-key rejections with reason \"duplicate-key\"", () => {
		expect.assertions(1);
		try {
			strictJsonParse(`{"a":1,"a":2}`);
		} catch (err) {
			expect(err).toMatchObject({ reason: "duplicate-key" });
		}
	});

	it("tags trailing-data rejections with reason \"trailing-data\"", () => {
		expect.assertions(1);
		try {
			strictJsonParse(`{"a":1} garbage`);
		} catch (err) {
			expect(err).toMatchObject({ reason: "trailing-data" });
		}
	});

	it("tags syntax failures with reason \"syntax\"", () => {
		expect.assertions(1);
		try {
			strictJsonParse(`{a:1}`);
		} catch (err) {
			expect(err).toMatchObject({ reason: "syntax" });
		}
	});

	it("parses standard JSON values equivalently to JSON.parse for a well-formed document", () => {
		const text = `{"id":"d","n":1.5e2,"neg":-3,"b":true,"nil":null,"arr":[1,"two",false],"esc":"a\\n\\tb\\"c"}`;
		expect(strictJsonParse(text)).toEqual(JSON.parse(text));
	});

	it("treats \"__proto__\" as an own data property, not a prototype reassignment", () => {
		const text = `{"__proto__":{"polluted":true},"id":"safe"}`;
		const parsed = strictJsonParse(text);

		expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
		expect((parsed as Record<string, unknown>).polluted).toBeUndefined();

		const names = Object.getOwnPropertyNames(parsed);
		expect(names).toContain("__proto__");
		expect(names).toContain("id");

		expect(JSON.stringify(parsed)).toEqual(JSON.stringify(JSON.parse(text)));
	});
});
