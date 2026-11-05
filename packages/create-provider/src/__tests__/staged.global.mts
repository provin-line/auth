/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Stages the provin packages as this checkout has them once per test run, for
// the tests that generate an app: upstream's generator reads packages outside
// its release from a project pnpm installed them into, and nothing of this
// checkout is on npm. The project's path is provided as `stagedProject`.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { stageProvinPackages } from "../../../../scripts/stage-provin-packages.mjs";

declare module "vitest" {
	export interface ProvidedContext {
		stagedProject: string;
		/** The tarballs the project was installed from, for a test that serves them again. */
		stagedTarballs: string;
	}
}

export default async function setup(project: TestProject) {
	const dir = await mkdtemp(join(tmpdir(), "create-auth-provider-stage-"));
	const staged = await stageProvinPackages({ dir });
	// The registry serves only the install: the generator reads the project.
	await staged.close();
	project.provide("stagedProject", staged.project);
	project.provide("stagedTarballs", join(dir, "tarballs"));
	return async () => {
		await rm(dir, { recursive: true, force: true });
	};
}
