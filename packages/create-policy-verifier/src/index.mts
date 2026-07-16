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

// Public API of @provin-line/create-policy-verifier.
//
// The CLI in `cli.mts` is the consumer-facing entry, but exporting the
// generator as a library lets tests call it directly without spawning a
// child process, and lets future tooling (CI checks, monorepo regeneration
// scripts) reuse the same code path.

export {
	generatePolicyVerifierScaffold,
	type GenerateOptions,
	type GenerateResult,
} from "./generator.mjs";

export {
	DEFAULT_DEP_VERSIONS,
	DEFAULT_PACKAGE_MANAGER,
	DEFAULT_DPLAAX_MODULE_REF,
	DEFAULT_PORT,
	DEFAULT_LICENSE,
} from "./defaults.mjs";

export { ExistingDirectoryNonEmptyError } from "./errors.mjs";
