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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryNonceStore } from "../nonceStore.mjs";

describe("InMemoryNonceStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns true the first time a nonce is consumed", async () => {
		const store = new InMemoryNonceStore();
		try {
			const now = Date.now();
			await expect(store.consume("nonce-1", now + 1000)).resolves.toBe(true);
		} finally {
			store.stop();
		}
	});

	it("returns false on replay while the stored entry is still unexpired", async () => {
		const store = new InMemoryNonceStore();
		try {
			const now = Date.now();
			await expect(store.consume("nonce-2", now + 1000)).resolves.toBe(true);
			await expect(store.consume("nonce-2", now + 1000)).resolves.toBe(false);
		} finally {
			store.stop();
		}
	});

	it("treats a nonce whose stored expiry has passed as consumable again", async () => {
		const store = new InMemoryNonceStore();
		try {
			const now = Date.now();
			await expect(store.consume("nonce-3", now + 1000)).resolves.toBe(true);

			// Advance past the stored expiry without triggering the sweep.
			vi.setSystemTime(now + 1001);

			await expect(store.consume("nonce-3", now + 1001 + 1000)).resolves.toBe(true);
		} finally {
			store.stop();
		}
	});

	it("does not confuse two distinct nonces", async () => {
		const store = new InMemoryNonceStore();
		try {
			const now = Date.now();
			await expect(store.consume("nonce-a", now + 1000)).resolves.toBe(true);
			await expect(store.consume("nonce-b", now + 1000)).resolves.toBe(true);
		} finally {
			store.stop();
		}
	});

	it("periodic sweep evicts expired entries so replay of the same nonce+expiry after a long gap is treated as fresh", async () => {
		const store = new InMemoryNonceStore({ sweepIntervalMs: 100 });
		try {
			const now = Date.now();
			await expect(store.consume("nonce-sweep", now + 50)).resolves.toBe(true);

			// Advance past both the entry's expiry and a sweep tick.
			await vi.advanceTimersByTimeAsync(200);

			await expect(store.consume("nonce-sweep", Date.now() + 1000)).resolves.toBe(true);
		} finally {
			store.stop();
		}
	});

	it("stop() clears the sweep interval", () => {
		const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
		const store = new InMemoryNonceStore();
		store.stop();
		expect(clearIntervalSpy).toHaveBeenCalled();
		clearIntervalSpy.mockRestore();
	});
});
