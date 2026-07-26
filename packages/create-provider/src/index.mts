/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Public API of @provin-line/create-auth-provider.
//
// The CLI in `cli.mts` is the consumer-facing entry, but exporting the
// generator as a library lets tests call it directly without spawning a
// child process, and lets future tooling (CI checks, monorepo regeneration
// scripts) reuse the same code path.

export {
	generateAuthProviderScaffold,
	type GenerateOptions,
	type GenerateResult,
} from "./generator.mjs";

export {
	DEFAULT_DEP_VERSIONS,
	DEFAULT_DPLAAX_MODULE_REF,
	DEFAULT_LICENSE,
	DEFAULT_PACKAGE_MANAGER,
	DEFAULT_PORT,
	DEFAULT_REGISTRY_BASE_URL,
	isSupportedLicense,
	SUPPORTED_LICENSES,
} from "./defaults.mjs";

export { ExistingDirectoryNonEmptyError } from "./errors.mjs";
