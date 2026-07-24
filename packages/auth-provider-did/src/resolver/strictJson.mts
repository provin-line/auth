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

/**
 * A DID Document is untrusted input served by a registry over the network,
 * and `JSON.parse` is more permissive than the JSON grammar it's usually
 * assumed to enforce: it silently keeps the *last* value of a duplicate
 * object key (masking a registry bug or a tampering attempt that smuggles
 * two conflicting `id` fields past a naive reviewer of the raw bytes) and
 * ignores trailing data after the root value. `strictJsonParse` is a
 * recursive-descent parser over the standard JSON grammar (RFC 8259) that
 * rejects both.
 */
export class StrictJsonError extends Error {
	constructor(
		readonly reason: "duplicate-key" | "trailing-data" | "syntax",
		message?: string,
	) {
		super(message ?? `strict JSON parse failed: ${reason}`);
		this.name = "StrictJsonError";
	}
}

/**
 * Parses `text` as JSON, rejecting anything `JSON.parse` would silently
 * accept beyond the standard grammar: duplicate object keys (at any depth)
 * and trailing data after the root value. Unknown object members are
 * preserved as-is (not stripped) — this is a strictness upgrade over
 * `JSON.parse`, not a schema validator.
 */
export function strictJsonParse(text: string): unknown {
	try {
		return parseDocument(text);
	} catch (err) {
		if (err instanceof StrictJsonError) throw err;
		throw new StrictJsonError("syntax", err instanceof Error ? err.message : String(err));
	}
}

function parseDocument(text: string): unknown {
	const len = text.length;
	let i = 0;

	function fail(message: string): never {
		throw new StrictJsonError("syntax", `${message} at position ${i}`);
	}

	function isWhitespace(ch: string | undefined): boolean {
		return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
	}

	function isDigit(ch: string | undefined): boolean {
		return ch !== undefined && ch >= "0" && ch <= "9";
	}

	function skipWhitespace(): void {
		while (i < len && isWhitespace(text[i])) i++;
	}

	function expect(ch: string): void {
		if (text[i] !== ch) fail(`expected "${ch}"`);
		i++;
	}

	function parseValue(): unknown {
		skipWhitespace();
		const ch = text[i];
		if (ch === undefined) fail("unexpected end of input");
		if (ch === "{") return parseObject();
		if (ch === "[") return parseArray();
		if (ch === '"') return parseString();
		if (ch === "t") return parseKeyword("true", true);
		if (ch === "f") return parseKeyword("false", false);
		if (ch === "n") return parseKeyword("null", null);
		if (ch === "-" || isDigit(ch)) return parseNumber();
		fail(`unexpected character "${ch}"`);
	}

	function parseKeyword<T>(keyword: string, value: T): T {
		if (text.slice(i, i + keyword.length) !== keyword) fail(`expected "${keyword}"`);
		i += keyword.length;
		return value;
	}

	function parseObject(): Record<string, unknown> {
		i++; // consume '{'
		const result: Record<string, unknown> = {};
		const seenKeys = new Set<string>();
		skipWhitespace();
		if (text[i] === "}") {
			i++;
			return result;
		}
		for (;;) {
			skipWhitespace();
			if (text[i] !== '"') fail("expected string key");
			const key = parseString();
			if (seenKeys.has(key)) {
				throw new StrictJsonError("duplicate-key", `duplicate object key "${key}" at position ${i}`);
			}
			seenKeys.add(key);
			skipWhitespace();
			expect(":");
			// Use defineProperty rather than `result[key] = value`: a plain
			// bracket assignment for key `"__proto__"` does not create an own
			// property — it reassigns `result`'s prototype (`[[Set]]`
			// semantics), which both hides the member from
			// `Object.getOwnPropertyNames`/`JSON.stringify` (violating the
			// unknown-members-are-preserved contract) and can expose
			// attacker-controlled properties through the injected prototype.
			// `defineProperty` always creates an own data property, matching
			// `JSON.parse`'s (spec-mandated CreateDataProperty) behavior.
			Object.defineProperty(result, key, {
				value: parseValue(),
				writable: true,
				enumerable: true,
				configurable: true,
			});
			skipWhitespace();
			if (text[i] === ",") {
				i++;
				continue;
			}
			if (text[i] === "}") {
				i++;
				break;
			}
			fail('expected "," or "}"');
		}
		return result;
	}

	function parseArray(): unknown[] {
		i++; // consume '['
		const result: unknown[] = [];
		skipWhitespace();
		if (text[i] === "]") {
			i++;
			return result;
		}
		for (;;) {
			result.push(parseValue());
			skipWhitespace();
			if (text[i] === ",") {
				i++;
				continue;
			}
			if (text[i] === "]") {
				i++;
				break;
			}
			fail('expected "," or "]"');
		}
		return result;
	}

	function parseString(): string {
		i++; // consume opening quote
		let result = "";
		for (;;) {
			const ch = text[i];
			if (ch === undefined) fail("unterminated string");
			if (ch === '"') {
				i++;
				break;
			}
			if (ch === "\\") {
				i++;
				const esc = text[i];
				switch (esc) {
					case '"':
						result += '"';
						break;
					case "\\":
						result += "\\";
						break;
					case "/":
						result += "/";
						break;
					case "b":
						result += "\b";
						break;
					case "f":
						result += "\f";
						break;
					case "n":
						result += "\n";
						break;
					case "r":
						result += "\r";
						break;
					case "t":
						result += "\t";
						break;
					case "u": {
						const hex = text.slice(i + 1, i + 5);
						if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid unicode escape");
						result += String.fromCharCode(Number.parseInt(hex, 16));
						i += 4;
						break;
					}
					default:
						fail(`invalid escape character "${esc}"`);
				}
				i++;
			} else if (ch.charCodeAt(0) < 0x20) {
				fail("invalid control character in string");
			} else {
				result += ch;
				i++;
			}
		}
		return result;
	}

	function parseNumber(): number {
		const start = i;
		if (text[i] === "-") i++;
		if (text[i] === "0") {
			i++;
		} else if (isDigit(text[i])) {
			while (isDigit(text[i])) i++;
		} else {
			fail("invalid number");
		}
		if (text[i] === ".") {
			i++;
			if (!isDigit(text[i])) fail("invalid number");
			while (isDigit(text[i])) i++;
		}
		if (text[i] === "e" || text[i] === "E") {
			i++;
			if (text[i] === "+" || text[i] === "-") i++;
			if (!isDigit(text[i])) fail("invalid number");
			while (isDigit(text[i])) i++;
		}
		return Number(text.slice(start, i));
	}

	const value = parseValue();
	skipWhitespace();
	if (i < len) {
		throw new StrictJsonError("trailing-data", `unexpected trailing data at position ${i}`);
	}
	return value;
}
