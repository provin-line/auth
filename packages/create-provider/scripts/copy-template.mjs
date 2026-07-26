/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Copies src/template/ → dist/template/ after tsc runs, so the published
// package ships the template tree alongside the compiled generator. Vitest
// reads src/template/ directly during dev, so this script only matters
// post-build (consumer install, Docker image, etc.).

import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const pkgRoot = new URL("../", import.meta.url);
const srcTemplate = new URL("./src/template/", pkgRoot);
const distTemplate = new URL("./dist/template/", pkgRoot);

await cp(fileURLToPath(srcTemplate), fileURLToPath(distTemplate), {
	recursive: true,
	errorOnExist: false,
	force: true,
});
