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
import { grants } from "@o3co/auth-provider-oauth/grants";
import { z } from "zod";

const grantType = "https://dplaax.dev/oauth/grant-type/did";

const section = z.looseObject({});

export default defineModule({ name: "did-grant", section }, (m) => [
	m.contribute(grants).by(() => ({
		grantType,
		readsAmbient: "none" as const,
		handle: async () => ({ kind: "error" as const, error: "invalid_request" }),
	})),
]);
