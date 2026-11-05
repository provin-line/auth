#!/usr/bin/env node
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

// A loopback-only npm registry for tests and the local and CI generation of
// instances: it serves the packuments and tarballs of the packages packed into
// one directory, and answers 404 for any other name, so a project points one
// scope at it (`@provin-line:registry=<url>/`) and takes the rest from its own
// registry. Every version reads as published when the server started.
//
// Usage: node scripts/local-registry.mjs <tarball-dir> [port]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The packuments of the tarballs in `dir`, their tarball URLs under `base`. */
function packumentsOf(dir, base) {
	const packages = new Map();
	const now = new Date().toISOString();
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".tgz"))) {
		const bytes = readFileSync(join(dir, file));
		const manifest = JSON.parse(
			execFileSync("tar", ["-xzOf", join(dir, file), "package/package.json"], { encoding: "utf8" }),
		);
		const entry = packages.get(manifest.name) ?? { name: manifest.name, versions: {}, "dist-tags": {}, time: {} };
		entry.versions[manifest.version] = {
			...manifest,
			dist: {
				tarball: `${base}/-/${file}`,
				integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
				shasum: createHash("sha1").update(bytes).digest("hex"),
			},
		};
		entry["dist-tags"].latest = manifest.version;
		entry.time[manifest.version] = now;
		packages.set(manifest.name, entry);
	}
	return packages;
}

/**
 * Serves the tarballs in `dir` on 127.0.0.1. Port 0 takes a free one.
 * Resolves with the registry's URL, no trailing slash, and a `close`.
 */
export function serveTarballs(dir, { port = 0 } = {}) {
	return new Promise((resolve, reject) => {
		let packages = new Map();
		const server = createServer((req, res) => {
			const url = decodeURIComponent(req.url ?? "/");
			if (url.startsWith("/-/")) {
				try {
					const bytes = readFileSync(join(dir, url.slice(3).replace(/[/\\]/g, "")));
					res.writeHead(200, { "content-type": "application/octet-stream" }).end(bytes);
				} catch {
					res.writeHead(404).end();
				}
				return;
			}
			const entry = packages.get(url.slice(1));
			if (!entry) {
				res.writeHead(404, { "content-type": "application/json" }).end("{}");
				return;
			}
			res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(entry));
		});
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			const address = server.address();
			const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`;
			packages = packumentsOf(dir, base);
			resolve({
				url: base,
				names: [...packages.keys()],
				close: () => new Promise((done) => server.close(() => done())),
			});
		});
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [dir, port] = process.argv.slice(2);
	if (dir === undefined) {
		console.error("usage: local-registry.mjs <tarball-dir> [port]");
		process.exit(2);
	}
	const { url, names } = await serveTarballs(dir, { port: Number(port ?? 0) });
	console.error(`registry on ${url}: ${names.join(", ")}`);
}
