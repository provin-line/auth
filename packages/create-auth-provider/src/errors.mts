/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Thrown by `generateAuthProviderScaffold` when the output directory exists
 * and is non-empty. Per create-app.md § 4.3 the generator refuses to merge / overwrite;
 * the consumer must delete the directory or scaffold to a sibling path.
 */
export class ExistingDirectoryNonEmptyError extends Error {
	constructor(public readonly path: string) {
		super(
			`Target directory is not empty: ${path}\n` +
				"Refusing to merge or overwrite. Delete the directory first " +
				"or scaffold to a sibling path.",
		);
		this.name = "ExistingDirectoryNonEmptyError";
	}
}
