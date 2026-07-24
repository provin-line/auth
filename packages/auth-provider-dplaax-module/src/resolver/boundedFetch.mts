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

export interface BoundedFetchOptions {
	timeoutMs: number;
	maxBodyBytes: number;
	maxConcurrent: number;
}

export const DEFAULT_BOUNDS: BoundedFetchOptions = {
	timeoutMs: 5_000,
	maxBodyBytes: 1_048_576,
	maxConcurrent: 8,
};

export interface BoundedFetchResult {
	status: number;
	// Pinned to the concrete `ArrayBuffer` backing (not the default
	// `ArrayBufferLike`, which also covers `SharedArrayBuffer`): the bytes
	// here always come from a fresh `new Uint8Array(length)` allocation in
	// readBoundedBody, and downstream consumers (e.g. `crypto.subtle.digest`)
	// require `BufferSource`, which excludes `SharedArrayBuffer`-backed views.
	bytes: Uint8Array<ArrayBuffer>;
	finalOrigin: string;
}

/** A single bounded-fetch call: the final connection's origin, resolved outside this module. */
export type BoundedFetch = (url: string) => Promise<BoundedFetchResult>;

/**
 * A ~10-line promise semaphore: `acquire()` resolves immediately while fewer
 * than `maxConcurrent` callers hold a slot, otherwise it queues the caller
 * (FIFO) until a slot is released. No timers — release is driven entirely by
 * callers invoking the function `acquire()` resolves to.
 */
function createSemaphore(maxConcurrent: number): () => Promise<() => void> {
	let active = 0;
	const queue: Array<() => void> = [];
	return async function acquire(): Promise<() => void> {
		if (active >= maxConcurrent) {
			await new Promise<void>((resolve) => queue.push(resolve));
		}
		active++;
		return function release(): void {
			active--;
			queue.shift()?.();
		};
	};
}

// Maps a failure from fetchImpl (headers) or from streaming the body into
// the two-class error taxonomy. AbortError (this module's own timeout, or a
// caller-supplied signal) is always transient/indeterminate; TypeError is
// how both `fetch` and `undici` report network-level failures (DNS,
// connection refused, TLS, and — the reason `redirect: "error"` lands here
// too — a redirect response the fetch implementation refused to follow).
function classifyTransportError(err: unknown, url: string, timeoutMs: number): Error {
	if (err instanceof Error && err.name === "AbortError") {
		return new ResolutionUnavailableError(
			"timeout",
			`bounded fetch timed out after ${timeoutMs}ms: ${url}`,
		);
	}
	if (err instanceof TypeError) {
		return new ResolutionUnavailableError(
			"network",
			`bounded fetch network error for ${url}: ${err.message}`,
		);
	}
	return err instanceof Error ? err : new Error(String(err));
}

// Reads `res.body` via its reader, accumulating chunks, and throws the
// instant received bytes exceed maxBodyBytes — never buffers the whole body
// first. `res.body === null` (e.g. a 204/304-shaped response) yields empty
// bytes rather than throwing.
async function readBoundedBody(
	res: Response,
	maxBodyBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
	if (res.body === null) {
		return new Uint8Array(0);
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		received += value.byteLength;
		if (received > maxBodyBytes) {
			await reader.cancel?.().catch(() => {});
			throw new ResolutionRejectedError(
				"body-too-large",
				`response body exceeded ${maxBodyBytes} bytes`,
			);
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/**
 * Builds a bounded HTTP transport: timeout, body-size cap (checked
 * incrementally while streaming, not after full buffering), redirect
 * refusal, and bounded concurrency — the "resource floor" every outbound DID
 * resolution request must clear before its response bytes are trusted.
 *
 * Call once per resolver instance (or similar long-lived owner); the
 * returned function's concurrency semaphore is shared across all calls made
 * through it.
 */
export function createBoundedFetch(
	opts: BoundedFetchOptions,
	fetchImpl: typeof fetch = fetch,
): BoundedFetch {
	const acquire = createSemaphore(opts.maxConcurrent);

	return async function boundedFetch(url: string): Promise<BoundedFetchResult> {
		const release = await acquire();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
		try {
			let res: Response;
			try {
				res = await fetchImpl(url, {
					// "error" makes fetch reject instead of following a redirect.
					// That refusal is what makes finalOrigin trustworthy: the
					// connection that ultimately served the bytes IS the URL we
					// requested, never wherever a redirect chain silently sent
					// us — satisfying auth.resolve.origin-pin without this
					// module needing to know anything about DIDs.
					redirect: "error",
					signal: controller.signal,
				});
			} catch (err) {
				throw classifyTransportError(err, url, opts.timeoutMs);
			}

			const finalOrigin = new URL(res.url || url).origin;

			// Classify by status BEFORE reading the body. A non-2xx response
			// (most importantly a 5xx outage) must surface its status
			// immediately: reading first would either delay a known outage
			// behind a slow/hanging body, or throw `body-too-large` for an
			// oversized error body — turning a real 503 into a wrong 400
			// (dplaax.mts's ResolutionRejectedError mapping) instead of the
			// promised 503. `dplaax.mts` only reads `bytes` on the 2xx/success
			// path, so skipping the read here costs the caller nothing.
			// Cancel (don't drain) the stream so it's freed rather than left
			// hanging; best-effort — mocked/degenerate `body` shapes in tests
			// may not implement `cancel()`.
			if (res.status < 200 || res.status >= 300) {
				try {
					await res.body?.cancel?.();
				} catch {
					// best-effort cleanup only
				}
				return { status: res.status, bytes: new Uint8Array(0), finalOrigin };
			}

			let bytes: Uint8Array<ArrayBuffer>;
			try {
				bytes = await readBoundedBody(res, opts.maxBodyBytes);
			} catch (err) {
				if (err instanceof ResolutionRejectedError) {
					throw err;
				}
				throw classifyTransportError(err, url, opts.timeoutMs);
			}

			return { status: res.status, bytes, finalOrigin };
		} finally {
			clearTimeout(timer);
			release();
		}
	};
}
