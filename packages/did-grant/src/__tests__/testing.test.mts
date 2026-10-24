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

import { memoryRecords } from "@o3co/auth-provider-foundation/records/testing";
import { spentNoncesContract } from "../testing.mjs";

spentNoncesContract("records stand-in", async () => {
	let now = 0;
	const stand = memoryRecords<true>(() => now, { shards: 1, perShard: 1 });
	return {
		spent: { save: (name, lifetimeMs) => stand.records.create(name, true, lifetimeMs) },
		advance: (ms) => {
			now += ms;
		},
	};
});
