/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// The package's runtime exports are a contract with its consumers: adding or
// removing one is a decision, so the list is pinned here.

import { describe, expect, it } from "vitest";
import * as api from "../index.mjs";

describe("public API of @provin-line/create-auth-provider", () => {
	it("exports exactly these runtime identifiers", () => {
		expect(Object.keys(api).sort()).toEqual([
			"DEFAULT_DEP_VERSIONS",
			"DEFAULT_DPLAAX_MODULE_REF",
			"DEFAULT_LICENSE",
			"DEFAULT_REGISTRY_BASE_URL",
			"ExistingDirectoryNonEmptyError",
			"LISTED_MODULES",
			"SUPPORTED_LICENSES",
			"generateAuthProviderScaffold",
			"isSupportedLicense",
		]);
	});
});
