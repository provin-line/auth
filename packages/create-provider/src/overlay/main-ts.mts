/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { PROVIN_MODULES } from "./modules.mjs";

const MODULE_IMPORT = /^import \w+ from "[^"]+\/module";$/gm;
const MODULE_LIST = /modules: \[([^\]]*)\]/;

/** The entry point importing the provin modules and assembling them with upstream's. */
export function patchMainTs(text: string): string {
	const imports = [...text.matchAll(MODULE_IMPORT)];
	const last = imports.at(-1);
	if (last === undefined || !MODULE_LIST.test(text)) {
		throw new Error(
			"src/main.ts: no module imports and `modules: [...]` list to extend",
		);
	}
	const end = (last.index ?? 0) + last[0].length;
	const added = PROVIN_MODULES.map(
		(m) => `import ${m.importName} from "${m.packageName}/module";`,
	);
	const withImports = `${text.slice(0, end)}\n${added.join("\n")}${text.slice(end)}`;
	return withImports.replace(
		MODULE_LIST,
		(_, list: string) =>
			`modules: [${list}, ${PROVIN_MODULES.map((m) => m.importName).join(", ")}]`,
	);
}
