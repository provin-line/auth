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
import type { SpentNonces } from "./contract.mjs";

/** A place that keeps spent nonces, as one implementation of the contract offers it. */
export interface SpentNoncesPlace {
	readonly spent: SpentNonces;
	/** Moves the place's clock on, so lifetimes run out. */
	advance(ms: number): void;
	/** Where answers can be lost: the next write takes effect, but its answer is lost. */
	readonly loseNextAnswer?: () => void;
	/** Where the place replicates: a replica takes over, keeping only what was confirmed. */
	readonly failover?: () => Promise<void>;
	/** Where the place can restart: it does, keeping only what it holds durably. */
	readonly restart?: () => Promise<void>;
	/** Where memory can run short: it does, keeping only what is kept from eviction. */
	readonly pressMemory?: () => Promise<void>;
}

/**
 * What the DID grant needs from any implementation of `spentNonces`: a name
 * kept once, for exactly its lifetime, through faults (`spentNoncesNeeds`).
 */
export function spentNoncesContract(name: string, open: () => Promise<SpentNoncesPlace>): void {
	let n = 0;
	const fresh = () => `n-${++n}-${Math.random().toString(36).slice(2)}`;
	describe(`did-grant's spent nonces: ${name}`, () => {
		it("keeps a name once, for exactly its lifetime", async () => {
			const place = await open();
			const used = fresh();
			expect(await place.spent.save(used, 1000)).toBe("created");
			expect(await place.spent.save(used, 1000)).toBe("exists");
			place.advance(999);
			expect(await place.spent.save(used, 1000)).toBe("exists");
			place.advance(1);
			expect(await place.spent.save(used, 1000)).toBe("created");
		});

		it("keeps names through restarts, memory pressure, lost answers and failovers", async (context) => {
			const place = await open();
			const { loseNextAnswer: lose, failover, restart, pressMemory } = place;
			if (!lose || !failover || !restart || !pressMemory) return context.skip();
			const [kept, settled] = [fresh(), fresh()];
			await place.spent.save(kept, 60_000);
			lose();
			expect(await place.spent.save(settled, 60_000)).toBe("created");
			await failover();
			await restart();
			await pressMemory();
			expect(await place.spent.save(kept, 60_000)).toBe("exists");
			expect(await place.spent.save(settled, 60_000)).toBe("exists");
		});
	});
}
