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

import { assemble, kernelConfig } from "@o3co/auth-provider-foundation/kernel";
import { quietRuntime } from "@o3co/auth-provider-foundation/kernel/testing";
import { simulatedStore } from "@o3co/auth-provider-foundation/store/testing";
import { spentNonces } from "@provin-line/auth-did-grant";
import { spentNoncesContract } from "@provin-line/auth-did-grant/testing";
import wiring from "../module.mjs";

const runtime = quietRuntime({ clock: { now: () => 1_800_000_000_000 } });

spentNoncesContract("did-grant-store on records, on a simulated replicated store", async () => {
	const simulated = simulatedStore();
	const app = await assemble({ modules: [simulated.module, wiring], config: kernelConfig(), runtime });
	return {
		spent: app.get(spentNonces),
		advance: (ms) => simulated.shiftClock(ms),
		loseNextAnswer: () => simulated.loseNextReply(),
		failover: () => simulated.failover(),
		restart: () => simulated.restart(),
		pressMemory: () => simulated.pressMemory(),
	};
});
