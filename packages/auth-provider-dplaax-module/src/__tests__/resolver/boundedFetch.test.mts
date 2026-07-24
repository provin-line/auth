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
import { ResolutionRejectedError, ResolutionUnavailableError } from "@provin-line/auth-provider-did";
import { describe, expect, it } from "vitest";
import { createBoundedFetch, DEFAULT_BOUNDS } from "../../resolver/boundedFetch.mjs";

/**
 * Resource-floor transport: bounded timeout, bounded body size (checked
 * incrementally, never fully buffered before the check), redirect refusal,
 * and bounded concurrency. Every timing-sensitive case here is driven by
 * caller-controlled promises/signals — never real wall-clock waits or
 * fetchImpl stubs that ignore the abort signal — so the suite can never hang.
 */
describe("createBoundedFetch", () => {
	// Flushes the microtask queue without any timer/sleep, so the semaphore's
	// internal awaits (acquire -> fetchImpl call) get a chance to settle.
	async function flushMicrotasks(times = 6): Promise<void> {
		for (let i = 0; i < times; i++) {
			await Promise.resolve();
		}
	}

	it(
		"aborts a hanging request after timeoutMs",
		async () => {
			// Never resolves on its own — only reacts to the abort signal, so
			// there is no real timer/sleep anywhere in this test; the promise
			// settles the instant createBoundedFetch's internal setTimeout fires
			// and aborts the controller.
			const abortAwareHang: typeof fetch = ((_url: string, init?: RequestInit) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("The operation was aborted.", "AbortError"));
					});
				})) as typeof fetch;

			const bf = createBoundedFetch({ ...DEFAULT_BOUNDS, timeoutMs: 20 }, abortAwareHang);

			await expect(bf("https://r.example/x")).rejects.toThrow(ResolutionUnavailableError);
			await expect(bf("https://r.example/x")).rejects.toMatchObject({ reason: "timeout" });
		},
		5000,
	);

	it(
		"rejects a body exceeding maxBodyBytes without buffering it all",
		async () => {
			const chunkSize = 16;
			const totalChunks = 1024 / chunkSize; // 64 chunks if fully drained
			let reads = 0;

			function streamOf(totalBytes: number): typeof fetch {
				let sent = 0;
				return (async () => ({
					status: 200,
					url: "",
					body: {
						getReader: () => ({
							read: async () => {
								reads++;
								if (sent >= totalBytes) {
									return { done: true, value: undefined };
								}
								sent += chunkSize;
								return { done: false, value: new Uint8Array(chunkSize).fill(7) };
							},
						}),
					},
				})) as unknown as typeof fetch;
			}

			const bf = createBoundedFetch({ ...DEFAULT_BOUNDS, maxBodyBytes: 64 }, streamOf(1024));

			await expect(bf("https://r.example/x")).rejects.toThrow(ResolutionRejectedError);
			await expect(bf("https://r.example/x")).rejects.toMatchObject({ reason: "body-too-large" });

			// 64 bytes / 16-byte chunks = 5 reads to exceed the cap (80 > 64).
			// Each expect() above runs its own bf() call; if the implementation
			// buffered the whole 1024-byte body before checking, `reads` would
			// climb toward totalChunks * 2. This proves it stopped early both times.
			expect(reads).toBeLessThan(totalChunks);
		},
		5000,
	);

	it(
		"classifies a 5xx response by status without reading its body — an oversized 503 body never throws body-too-large",
		async () => {
			// C2: a 503 (outage) response with a body that exceeds maxBodyBytes
			// must surface as status 503 from boundedFetch, NOT throw
			// body-too-large (which the caller would map to a 400, hiding the
			// real 503 outage behind a wrong HTTP status).
			const chunkSize = 16;
			let reads = 0;
			function oversizedErrorBody(totalBytes: number): typeof fetch {
				let sent = 0;
				return (async () => ({
					status: 503,
					url: "",
					body: {
						getReader: () => ({
							read: async () => {
								reads++;
								if (sent >= totalBytes) {
									return { done: true, value: undefined };
								}
								sent += chunkSize;
								return { done: false, value: new Uint8Array(chunkSize).fill(7) };
							},
						}),
					},
				})) as unknown as typeof fetch;
			}

			const bf = createBoundedFetch(
				{ ...DEFAULT_BOUNDS, maxBodyBytes: 64 },
				oversizedErrorBody(1024),
			);

			const result = await bf("https://r.example/x");

			expect(result.status).toBe(503);
			expect(result.bytes.byteLength).toBe(0);
			// The body must never be read for a non-2xx response.
			expect(reads).toBe(0);
		},
		5000,
	);

	it(
		"does not hang waiting on a 5xx response body that never resolves its read()",
		async () => {
			// C2: even a body whose stream never yields must not delay
			// classification of a 5xx status — the caller needs the outage
			// signal immediately, not after a timeout.
			const hangingErrorBody: typeof fetch = (async () => ({
				status: 503,
				url: "",
				body: {
					getReader: () => ({
						// Never resolves — proves boundedFetch doesn't await this.
						read: () => new Promise(() => {}),
					}),
				},
			})) as unknown as typeof fetch;

			const bf = createBoundedFetch(DEFAULT_BOUNDS, hangingErrorBody);

			const result = await bf("https://r.example/x");

			expect(result.status).toBe(503);
			expect(result.bytes.byteLength).toBe(0);
		},
		500,
	);

	it(
		"passes redirect: 'error' to fetch (public profile rejects redirects)",
		async () => {
			let seen: RequestInit | undefined;
			const spy: typeof fetch = (async (_u, init) => {
				seen = init;
				return new Response("{}", { status: 200 });
			}) as typeof fetch;

			await createBoundedFetch(DEFAULT_BOUNDS, spy)("https://r.example/x");
			expect(seen?.redirect).toBe("error");
		},
		5000,
	);

	it(
		"limits concurrent in-flight requests to maxConcurrent",
		async () => {
			let started = 0;
			const releasers: Array<(res: Response) => void> = [];
			// Every call hangs until the test explicitly resolves it below — no
			// timers, no sleeps; the test drives every state transition itself.
			const gated: typeof fetch = (async () => {
				started++;
				return new Promise<Response>((resolve) => {
					releasers.push(resolve);
				});
			}) as typeof fetch;

			const bf = createBoundedFetch({ ...DEFAULT_BOUNDS, maxConcurrent: 2 }, gated);

			const p1 = bf("https://r.example/1");
			const p2 = bf("https://r.example/2");
			const p3 = bf("https://r.example/3");

			await flushMicrotasks();
			expect(started).toBe(2); // 3rd request queued, not yet started

			releasers[0](new Response("{}", { status: 200 }));
			await p1;
			await flushMicrotasks();

			expect(started).toBe(3); // a slot freed up, 3rd now started

			releasers[1](new Response("{}", { status: 200 }));
			releasers[2](new Response("{}", { status: 200 }));
			await Promise.all([p2, p3]);
		},
		5000,
	);
});
