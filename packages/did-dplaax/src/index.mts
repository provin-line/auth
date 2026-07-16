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

// Public surface for the did:dplaax grammar layer. Re-exported by both
// @provin-line/auth-provider-dplaax-module and @provin-line/policy-verifier-
// dplaax-module so the grammar has a single source of truth and downstream
// consumers can keep their existing import paths.

export { parseDplaaxDid, type ParsedDplaaxDid } from "./parse.mjs";

export {
	classifyDplaaxDid,
	getSupportedAccountTypes,
	isSupportedAccountType,
	requireKnownPattern,
	requireOwner,
	type SupportedAccountType,
	validateDplaaxDid,
} from "./validate.mjs";
