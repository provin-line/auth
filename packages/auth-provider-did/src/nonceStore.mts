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
 * Pluggable replay-protection store for the DID grant's nonce check.
 *
 * `consume` performs the check-and-store as a single call: it returns
 * `true` the first time a given `nonce` is seen (recording it until
 * `expiresAtMs`), and `false` if the same `nonce` is presented again before
 * `expiresAtMs`. A nonce whose previously stored expiry has already passed
 * is treated as unseen and is consumable again (returns `true`).
 */
export interface NonceStore {
	/** Returns `false` when `nonce` is a replay within its freshness window. */
	consume(nonce: string, expiresAtMs: number): Promise<boolean>;
}

export interface InMemoryNonceStoreOptions {
	/**
	 * How often the background sweep scans for expired entries and evicts
	 * them from the backing Map. Defaults to 60s (matches the DID grant's
	 * previous inline sweep). This is a memory-reclamation cadence only —
	 * `consume()` itself always checks freshness directly against the
	 * stored expiry, independent of when the sweep last ran.
	 */
	sweepIntervalMs?: number;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * In-memory single-process nonce store (PoC). Backed by a plain `Map` swept
 * periodically to bound memory growth; replay protection is correct without
 * the sweep (`consume` checks expiry directly) — the sweep only reclaims
 * memory for nonces nobody re-presents.
 *
 * Not safe for multi-replica deployments: each process has its own Map, so
 * a replay across two replicas would not be caught. Swap in a shared-store
 * implementation of `NonceStore` (e.g. Redis-backed) for that case.
 */
export class InMemoryNonceStore implements NonceStore {
	private readonly seen = new Map<string, number>(); // nonce -> expiresAtMs
	private readonly sweepInterval: ReturnType<typeof setInterval>;

	constructor(opts?: InMemoryNonceStoreOptions) {
		const sweepIntervalMs = opts?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;

		// `.unref()` so the interval does not keep the Node event loop alive
		// after AppHandle.dispose(). v0.5.x's manifest model contributes grant
		// handlers to the planner; AppHandle.dispose() does not iterate grant
		// handlers' `cleanup()`, so a non-unref'd interval would retain the
		// process across repeated test boot cycles or after graceful shutdown.
		this.sweepInterval = setInterval(() => {
			const now = Date.now();
			for (const [key, expiresAtMs] of this.seen) {
				if (now > expiresAtMs) this.seen.delete(key);
			}
		}, sweepIntervalMs);
		this.sweepInterval.unref();
	}

	async consume(nonce: string, expiresAtMs: number): Promise<boolean> {
		const existingExpiresAtMs = this.seen.get(nonce);
		const now = Date.now();
		if (existingExpiresAtMs !== undefined && existingExpiresAtMs > now) {
			return false; // replay within the freshness window
		}
		this.seen.set(nonce, expiresAtMs);
		return true;
	}

	/** Clears the background sweep interval. */
	stop(): void {
		clearInterval(this.sweepInterval);
	}
}
