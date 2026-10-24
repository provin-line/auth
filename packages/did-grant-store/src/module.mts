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

import { defineModule } from "@o3co/auth-provider-foundation/kernel";
import { recordsIn } from "@o3co/auth-provider-foundation/records";
import { type Guarantee, type Space, spaces, store } from "@o3co/auth-provider-foundation/store";
import { spentNonces, spentNoncesNeeds } from "@provin-line/auth-did-grant";

/** Each need did-grant states, as the guarantee a space declares for it. */
const guaranteeFor = {
	neverEvicted: "no-eviction",
	survivesCrash: "durable",
	survivesFailover: "replicated",
} as const satisfies Record<keyof typeof spentNoncesNeeds, Guarantee>;

const spent: Space = {
	name: "did-grant-store.spent",
	guarantees: Object.values(guaranteeFor),
};

export default defineModule({ name: "did-grant-store" }, (m) => [
	m.contribute(spaces).by(() => spent),
	m.provide(spentNonces).by(async (c) => {
		const records = recordsIn<true>({ store: await c.get(store), space: spent, log: c.log, random: c.random });
		return { save: (name: string, lifetimeMs: number) => records.create(name, true, lifetimeMs) };
	}),
]);
