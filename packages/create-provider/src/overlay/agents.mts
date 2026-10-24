/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { PROVIN_MODULES } from "../provin-modules.mjs";

const TABLE_ROW = /^\| `[^`]+` \|.*\|$/gm;

/** AGENTS.md's index of module cards, with the provin modules' rows. */
export function patchAgents(text: string): string {
	const rows = [...text.matchAll(TABLE_ROW)];
	const last = rows.at(-1);
	if (last === undefined) {
		throw new Error("AGENTS.md: no module table to add rows to");
	}
	const end = (last.index ?? 0) + last[0].length;
	const added = PROVIN_MODULES.map((m) => {
		const base = `node_modules/${m.packageName}`;
		const defaults = m.hasReferenceConf ? `\`${base}/reference.conf\`` : "";
		return `| \`${m.packageName}\` | \`${base}/README.md\` | ${defaults} |`;
	});
	return `${text.slice(0, end)}\n${added.join("\n")}${text.slice(end)}`;
}
