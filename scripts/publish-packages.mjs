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

// Packs and publishes the provin packages to npm, as
// .github/workflows/publish-packages.yml runs it on a release tag, in two
// steps so that the one holding the workflow's OIDC identity installs and
// builds nothing:
//
//   pack <dir>               packs into <dir> each package whose version the
//                            registry does not hold yet. pnpm packs, turning
//                            `workspace:` ranges into versions. In GitHub
//                            Actions it writes `count` to the step's outputs.
//   publish <dir> [--dry-run]
//                            publishes the tarballs in <dir> with npm, in
//                            dependency order. npm authenticates by trusted
//                            publishing and signs the provenance.
//
// A version the registry holds is left as it is at either step, so a re-run
// publishes nothing twice.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

// In dependency order: dplaax-registry depends on did-dplaax, and the grant's
// wiring and adapter take the grant as a peer.
const PACKAGES = ["did-dplaax", "did-grant", "did-grant-store", "dplaax-registry"];
const NPM_FLOOR = [11, 5, 1];

const root = join(import.meta.dirname, "..");
const manifestOf = (name) => JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8"));
const NAMES = PACKAGES.map((name) => manifestOf(name).name);
const [step, dir, ...flags] = process.argv.slice(2);
const known = step === "publish" ? ["--dry-run"] : [];
if ((step !== "pack" && step !== "publish") || dir === undefined || flags.some((f) => !known.includes(f))) {
	console.error("usage: publish-packages.mjs pack <dir> | publish <dir> [--dry-run]");
	process.exit(2);
}

/** Whether a dotted version is at least the floor. */
function atLeast(version, floor) {
	const parts = version.split(".").map(Number);
	for (const [i, n] of floor.entries()) if (parts[i] !== n) return parts[i] > n;
	return true;
}

/** Whether the registry holds this version; an unknown package holds none. */
function held(name, version) {
	try {
		const out = execFileSync("npm", ["view", `${name}@${version}`, "version", "--prefer-online"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return out.trim() === version;
	} catch (err) {
		if (String(err.stderr ?? "").includes("E404")) return false;
		throw err;
	}
}

function pack() {
	mkdirSync(dir, { recursive: true });
	let count = 0;
	for (const name of PACKAGES) {
		const cwd = join(root, "packages", name);
		const manifest = manifestOf(name);
		if (held(manifest.name, manifest.version)) {
			console.log(`${manifest.name}@${manifest.version}: on the registry, left as it is`);
			continue;
		}
		// A directory of its own inside <dir>, so the tarball is found by name and
		// moved on the same filesystem.
		const out = mkdtempSync(join(dir, ".pack-"));
		try {
			execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd, stdio: ["ignore", "ignore", "inherit"] });
			const [tarball] = readdirSync(out).filter((f) => f.endsWith(".tgz"));
			if (tarball === undefined) throw new Error(`${manifest.name}: pnpm pack wrote no tarball`);
			renameSync(join(out, tarball), join(dir, tarball));
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
		console.log(`${manifest.name}@${manifest.version}: packed`);
		count += 1;
	}
	if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${count}\n`);
}

function publish() {
	const dryRun = flags.includes("--dry-run");
	const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
	if (!atLeast(npmVersion, NPM_FLOOR)) {
		console.error(`npm ${npmVersion}: trusted publishing needs npm ${NPM_FLOOR.join(".")} or later`);
		process.exit(1);
	}
	const tarballs = readdirSync(dir)
		.filter((f) => f.endsWith(".tgz"))
		.map((file) => {
			const path = join(dir, file);
			const manifest = JSON.parse(execFileSync("tar", ["-xzOf", path, "package/package.json"], { encoding: "utf8" }));
			const order = NAMES.indexOf(manifest.name);
			if (order < 0) throw new Error(`${file}: ${manifest.name} is not a package this script publishes`);
			return { path, name: manifest.name, version: manifest.version, order };
		})
		.sort((a, b) => a.order - b.order);
	for (const { path, name, version } of tarballs) {
		if (held(name, version)) {
			console.log(`${name}@${version}: on the registry, left as it is`);
			continue;
		}
		// A prerelease goes under `next`. A release takes npm's default tag, so npm
		// refuses to move `latest` to a version below the one it names.
		const args = ["publish", path, "--access", "public"];
		if (version.includes("-")) args.push("--tag", "next");
		args.push(dryRun ? "--dry-run" : "--provenance");
		execFileSync("npm", args, { stdio: "inherit" });
		console.log(`${name}@${version}: ${dryRun ? "would be published" : "published"}`);
	}
}

if (step === "pack") pack();
else publish();
