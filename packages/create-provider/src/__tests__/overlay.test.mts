/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

// Each transformation of the overlay is a pure function over one generated
// file; the fixtures are cut from what the upstream generator writes, so an
// upstream change that moves an anchor fails here before it fails a build.

import { describe, expect, it } from "vitest";
import {
	applyProvinModules,
	type OverlayOptions,
} from "../overlay/index.mjs";
import { patchAgents } from "../overlay/agents.mjs";
import {
	patchApplicationConf,
	patchEnvExample,
	patchLocalConfExample,
} from "../overlay/config.mjs";
import { patchMainTs } from "../overlay/main-ts.mjs";
import { patchPackageJson } from "../overlay/package-json.mjs";
import { patchReadme } from "../overlay/readme.mjs";
import { buildWorkspaceYaml } from "../overlay/workspace-yaml.mjs";

const REF = "0123456789abcdef0123456789abcdef01234567";

const options: OverlayOptions = {
	name: "@acme/login",
	description: "Acme login",
	license: "Apache-2.0",
	author: "Acme",
	moduleRef: REF,
	registryBaseUrl: "http://registry.internal:8443",
};

const UPSTREAM_PACKAGE_JSON = `{
	"name": "auth-provider-app",
	"private": true,
	"type": "module",
	"packageManager": "pnpm@11.28.7",
	"scripts": {
		"start": "node --env-file-if-exists=.env src/main.ts"
	},
	"dependencies": {
		"@o3co/auth-provider-foundation": "0.18.4",
		"zod": "4.6.7"
	}
}
`;

const UPSTREAM_MAIN = `import { assemble, BootRefused } from "@o3co/auth-provider-foundation/kernel";
import m17 from "@o3co/auth-provider-metrics-publishers/metrics-prometheus/module";
import m18 from "@o3co/auth-provider-log-sinks/log-stdout/module";

const files = [];
return assemble({ modules: [m0, m1, m17, m18], config });
`;

const UPSTREAM_CONF = `# Each key reads its environment variable (see .env.example); this file holds no values.
kernel {
	deployment = \${?KERNEL_DEPLOYMENT}
}
keys {
	signing {
		kid = \${?KEYS_SIGNING_KID}
		alg = \${?KEYS_SIGNING_ALG}
		private-key = \${?KEYS_SIGNING_PRIVATE_KEY}
	}
}
`;

const UPSTREAM_ENV = `## Copy to .env, uncomment each line you set.
# KERNEL_DEPLOYMENT=single
# KEYS_SIGNING_ALG=EdDSA
`;

const UPSTREAM_LOCAL = `## Copy to config/local.conf, uncomment each key.
# outbound.allow = [
# 	"destination.example.invalid"
# ]
# audit.receivers = [REPLACE-RECEIVER-NAMES]
# clients.registered = [
# 	{
# 		"id": "example-client",
# 		"kind": "public",
# 		"method": "none"
# 	}
# ]
# keys.signing.private-key = """-----BEGIN PRIVATE KEY-----
# REPLACE-PKCS8-PEM-PRIVATE-KEY
# -----END PRIVATE KEY-----"""
`;

describe("patchPackageJson", () => {
	const out = JSON.parse(patchPackageJson(UPSTREAM_PACKAGE_JSON, options));

	it("takes name, description, license and author from the options", () => {
		expect(out.name).toBe("@acme/login");
		expect(out.description).toBe("Acme login");
		expect(out.license).toBe("Apache-2.0");
		expect(out.author).toBe("Acme");
	});

	it("leaves out author when none is given", () => {
		const bare = JSON.parse(
			patchPackageJson(UPSTREAM_PACKAGE_JSON, { ...options, author: "" }),
		);
		expect(bare).not.toHaveProperty("author");
	});

	it("keeps what upstream wrote", () => {
		expect(out.packageManager).toBe("pnpm@11.28.7");
		expect(out.scripts.start).toBe("node --env-file-if-exists=.env src/main.ts");
		expect(out.dependencies["@o3co/auth-provider-foundation"]).toBe("0.18.4");
		expect(out.dependencies.zod).toBe("4.6.7");
	});

	it("adds the three provin modules as git-subdirectory refs at the pin", () => {
		expect(out.dependencies["@provin-line/auth-did-grant"]).toBe(
			`github:provin-line/auth#${REF}&path:/packages/did-grant`,
		);
		expect(out.dependencies["@provin-line/auth-dplaax-registry"]).toBe(
			`github:provin-line/auth#${REF}&path:/packages/dplaax-registry`,
		);
		expect(out.dependencies["@provin-line/auth-did-grant-store"]).toBe(
			`github:provin-line/auth#${REF}&path:/packages/did-grant-store`,
		);
	});

	it("adds @noble/ed25519 as an exact pin, for the default algorithm", () => {
		expect(out.dependencies["@noble/ed25519"]).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it("lets the options win over fields upstream wrote", () => {
		const upstream = JSON.stringify({
			name: "x",
			license: "MIT",
			author: "someone",
			description: "d",
			dependencies: {},
		});
		const out = JSON.parse(patchPackageJson(upstream, options));
		expect(out.license).toBe("Apache-2.0");
		expect(out.author).toBe("Acme");
		expect(out.description).toBe("Acme login");
		const bare = JSON.parse(patchPackageJson(upstream, { ...options, author: "" }));
		expect(bare).not.toHaveProperty("author");
	});

	it("escapes free-form values", () => {
		const tricky = JSON.parse(
			patchPackageJson(UPSTREAM_PACKAGE_JSON, {
				...options,
				description: 'say "hi"\nthere',
			}),
		);
		expect(tricky.description).toBe('say "hi"\nthere');
	});

	it("refuses a manifest without dependencies", () => {
		expect(() => patchPackageJson("{}", options)).toThrow(/dependencies/);
	});
});

describe("buildWorkspaceYaml", () => {
	const text = buildWorkspaceYaml(REF);

	it("pins the transitive @provin-line packages to the same ref", () => {
		expect(text).toContain(
			`"@provin-line/did-dplaax": "github:provin-line/auth#${REF}&path:/packages/did-dplaax"`,
		);
		expect(text).toContain(
			`"@provin-line/auth-did-grant": "github:provin-line/auth#${REF}&path:/packages/did-grant"`,
		);
	});

	const PACKAGES = [
		["@provin-line/auth-did-grant", "did-grant"],
		["@provin-line/auth-dplaax-registry", "dplaax-registry"],
		["@provin-line/auth-did-grant-store", "did-grant-store"],
		["@provin-line/did-dplaax", "did-dplaax"],
	] as const;

	it("allows the build scripts of the git-fetched packages, keyed by the tarball pnpm resolves them to", () => {
		for (const [name, dir] of PACKAGES) {
			expect(text).toContain(
				`"${name}@https://codeload.github.com/provin-line/auth/tar.gz/${REF}#path:/packages/${dir}": true`,
			);
		}
	});

	it("also keys them by the git source pnpm resolves to when the repo is fetched through git", () => {
		for (const [name, dir] of PACKAGES) {
			expect(text).toContain(
				`"${name}@git+https://github.com/provin-line/auth.git#${REF}&path:/packages/${dir}": true`,
			);
		}
	});

	it("lets the transitive packages the overrides pin be fetched from git", () => {
		expect(text).toMatch(/^blockExoticSubdeps: false$/m);
	});

	it("scopes the allowance to the repository for a ref that is not a commit SHA", () => {
		const branch = buildWorkspaceYaml("develop");
		for (const [name] of PACKAGES) {
			expect(branch).toContain(
				`"${name}@git+https://github.com/provin-line/auth.git": true`,
			);
		}
		expect(branch).not.toContain("codeload");
		expect(branch).toContain("develop&path:/packages/did-dplaax");
	});

	it("quotes every key, which begins with @", () => {
		for (const line of text.split("\n").filter((l) => l.startsWith("  "))) {
			expect(line).toMatch(/^  "[^"]+": /);
		}
	});

	it("says why exotic sub-dependencies are allowed", () => {
		expect(text).toMatch(/^# .*blockExoticSubdeps|^# .*exotic/im);
	});

	it("quotes a ref that carries YAML-significant characters", () => {
		expect(buildWorkspaceYaml('a"b: c')).toContain(String.raw`a\"b: c`);
	});
});

describe("patchMainTs", () => {
	const out = patchMainTs(UPSTREAM_MAIN);

	it("imports the three module defaults after upstream's imports", () => {
		expect(out).toContain(
			'import didGrant from "@provin-line/auth-did-grant/module";',
		);
		expect(out).toContain(
			'import dplaaxRegistry from "@provin-line/auth-dplaax-registry/module";',
		);
		expect(out).toContain(
			'import didGrantStore from "@provin-line/auth-did-grant-store/module";',
		);
		expect(out.indexOf("didGrant from")).toBeGreaterThan(out.indexOf("m18 from"));
	});

	it("appends them to the assemble list", () => {
		expect(out).toContain(
			"modules: [m0, m1, m17, m18, didGrant, dplaaxRegistry, didGrantStore]",
		);
	});

	it("refuses a main.ts it cannot place the modules in", () => {
		expect(() => patchMainTs("console.log(1)\n")).toThrow(/main\.ts/);
	});
});

describe("patchApplicationConf", () => {
	const out = patchApplicationConf(UPSTREAM_CONF);

	it("gives the did-grant section a key per setting, each reading its variable", () => {
		expect(out).toContain(
			"revocation-latency-bound = ${?DID_GRANT_REVOCATION_LATENCY_BOUND}",
		);
		expect(out).toContain(
			"access-token-lifetime = ${?DID_GRANT_ACCESS_TOKEN_LIFETIME}",
		);
		expect(out).toMatch(/^did-grant \{$/m);
	});

	it("gives the dplaax-registry section its keys", () => {
		expect(out).toMatch(/^dplaax-registry \{$/m);
		expect(out).toContain("url = ${?DPLAAX_REGISTRY_URL}");
	});

	it("lets tokens state that no module checks subject revocation", () => {
		expect(out).toMatch(/^tokens \{\n\tsubject-check = \$\{\?TOKENS_SUBJECT_CHECK\}\n\}$/m);
	});

	it("lets keys.signing read a shared secret and how to read it", () => {
		expect(out).toContain("secret = ${?KEYS_SIGNING_SECRET}");
		expect(out).toContain(
			"secret-encoding = ${?KEYS_SIGNING_SECRET_ENCODING}",
		);
		expect(out.indexOf("secret = ")).toBeGreaterThan(out.indexOf("private-key"));
	});

	it("holds no value of its own: every assignment is an optional substitution", () => {
		const assigned = out.split("\n").filter((l) => l.includes("="));
		expect(assigned.length).toBeGreaterThan(0);
		for (const line of assigned) {
			expect(line).toMatch(/= \$\{\?[A-Z0-9_]+\}$/);
		}
	});

	it("refuses a file without keys.signing", () => {
		expect(() => patchApplicationConf("kernel {\n}\n")).toThrow(/keys\.signing/);
	});
});

describe("patchEnvExample", () => {
	const out = patchEnvExample(UPSTREAM_ENV, options);

	it("lists each variable the added keys read", () => {
		for (const name of [
			"KEYS_SIGNING_SECRET",
			"KEYS_SIGNING_SECRET_ENCODING",
			"DID_GRANT_REVOCATION_LATENCY_BOUND",
			"DID_GRANT_ACCESS_TOKEN_LIFETIME",
			"DPLAAX_REGISTRY_URL",
		]) {
			expect(out).toMatch(new RegExp(`^# ${name}=`, "m"));
		}
	});

	it("lists TOKENS_SUBJECT_CHECK, which boot requires while no module checks subjects", () => {
		expect(out).toMatch(/^# TOKENS_SUBJECT_CHECK=none$/m);
	});

	it("defaults the registry URL to the option", () => {
		expect(out).toContain("# DPLAAX_REGISTRY_URL=http://registry.internal:8443");
	});

	it("marks the secret's placeholder so boot refuses it as it stands", () => {
		expect(out).toMatch(/^# KEYS_SIGNING_SECRET=REPLACE-/m);
	});

	it("names utf8 as the encoding, the verifier's reading", () => {
		expect(out).toContain("# KEYS_SIGNING_SECRET_ENCODING=utf8");
	});

	it("keeps upstream's lines", () => {
		expect(out.startsWith(UPSTREAM_ENV)).toBe(true);
	});
});

describe("patchLocalConfExample", () => {
	const out = patchLocalConfExample(UPSTREAM_LOCAL, options);

	it("allows the registry's host", () => {
		expect(out).toContain('# \t"registry.internal"');
		expect(out).not.toContain("destination.example.invalid");
	});

	it("names the registry's host and port for plain http inside the network", () => {
		expect(out).toMatch(
			/# outbound\.plain-internal = \[\n# \t"registry\.internal:8443"\n# \]/,
		);
	});

	it("allows the DID grant type in the example client", () => {
		expect(out).toContain('# \t\t"sections": {');
		expect(out).toContain('"grants": ["https://dplaax.dev/oauth/grant-type/did"]');
	});

	it("keeps the other keys", () => {
		expect(out).toContain("# audit.receivers = [REPLACE-RECEIVER-NAMES]");
		expect(out).toContain("# keys.signing.private-key");
	});

	it("names no plain-internal pair for an https registry, which needs no plain http", () => {
		const https = patchLocalConfExample(UPSTREAM_LOCAL, {
			...options,
			registryBaseUrl: "https://registry.example.org",
		});
		expect(https).toContain('# \t"registry.example.org"');
		expect(https).not.toContain("plain-internal =");
		expect(https).toContain("outbound.internal-hosts");
	});

	it("uses port 80 for an http registry URL that names none", () => {
		const http = patchLocalConfExample(UPSTREAM_LOCAL, {
			...options,
			registryBaseUrl: "http://registry.example.org",
		});
		expect(http).toContain('"registry.example.org:80"');
	});

	it("refuses an example without outbound.allow", () => {
		expect(() => patchLocalConfExample("## nothing\n", options)).toThrow(
			/outbound\.allow/,
		);
	});
});

describe("patchReadme", () => {
	const upstream = "# Auth provider\n\nGenerated by `create-auth-provider`.\n\n## Docker\n";
	const out = patchReadme(upstream, options);

	it("names the project and its description", () => {
		expect(out.startsWith("# @acme/login\n\nAcme login\n")).toBe(true);
	});

	it("names the provin modules and links their cards as installed", () => {
		for (const name of ["auth-did-grant", "auth-dplaax-registry", "auth-did-grant-store"]) {
			expect(out).toContain(`node_modules/@provin-line/${name}/README.md`);
		}
	});

	it("names the settings the modules need", () => {
		expect(out).toContain("did-grant.revocation-latency-bound");
		expect(out).toContain("did-grant.access-token-lifetime");
		expect(out).toContain("dplaax-registry.url");
		expect(out).toContain("keys.signing.secret-encoding");
		expect(out).toContain("clients.registered");
		expect(out).toContain("outbound.plain-internal");
	});

	it("tells what introspection takes and what a restart forgets", () => {
		expect(out).toContain("/oauth/introspect");
		expect(out).toContain("sections.client-secret.hash");
		expect(out).toMatch(/revoked tokens live in this process/);
	});

	it("states that boot requires tokens.subject-check", () => {
		expect(out).toContain("tokens.subject-check");
		expect(out).toContain("TOKENS_SUBJECT_CHECK");
	});

	it("warns that a volatile nonce store reopens a replay window after a restart", () => {
		expect(out).toMatch(/restart/);
		expect(out).toContain("message-max-age");
	});

	it("explains blockExoticSubdeps and regenerating instead of editing the ref", () => {
		expect(out).toContain("blockExoticSubdeps");
		expect(out).toMatch(/regenerat/i);
		expect(out).toContain("minimumReleaseAgeExclude");
	});

	it("replaces upstream's Changing-the-modules section, whose commands are not this generator's", () => {
		const withSection =
			"# Auth provider\n\n## Changing the modules\n\nGenerate again. `create-auth-provider <target> --pattern <pattern>` and `--add`.\n\n## Last\n\nkept\n";
		const patched = patchReadme(withSection, options);
		expect(patched).not.toContain("<target>");
		expect(patched).toContain("would drop them");
		expect(patched).toContain("## Changing the modules");
		expect(patched).toMatch(/provin|@provin-line\/create-auth-provider/);
		expect(patched).toContain("## Last\n\nkept");
	});

	it("refuses a README without a title", () => {
		expect(() => patchReadme("no title\n", options)).toThrow(/README/);
	});
});

describe("patchAgents", () => {
	const upstream = `# Index\n\n| Module | Card | Section defaults |\n|---|---|---|\n| \`@mod/kernel\` | \`a\` | \`b\` |\n| \`@mod/log-stdout\` | \`c\` |  |\n\nEvery module.\n`;
	const out = patchAgents(upstream);

	it("indexes the provin modules with their cards and section defaults", () => {
		expect(out).toContain(
			"| `@provin-line/auth-did-grant` | `node_modules/@provin-line/auth-did-grant/README.md` | `node_modules/@provin-line/auth-did-grant/reference.conf` |",
		);
		expect(out).toContain("`node_modules/@provin-line/auth-did-grant-store/README.md` |  |");
	});

	it("puts them inside the table", () => {
		expect(out.indexOf("auth-did-grant-store")).toBeLessThan(out.indexOf("Every module."));
		expect(out.indexOf("@mod/log-stdout")).toBeLessThan(out.indexOf("auth-did-grant`"));
	});
});

describe("applyProvinModules", () => {
	const files = new Map<string, string>([
		["package.json", UPSTREAM_PACKAGE_JSON],
		["src/main.ts", UPSTREAM_MAIN],
		["config/application.conf", UPSTREAM_CONF],
		[".env.example", UPSTREAM_ENV],
		["config/local.conf.example", UPSTREAM_LOCAL],
		["README.md", "# Auth provider\n"],
		["AGENTS.md", "| a |\n|---|\n| `@mod/x` | `y` |\n"],
		["Dockerfile", "FROM node\n"],
	]);
	const out = applyProvinModules(files, options);

	it("adds pnpm-workspace.yaml", () => {
		expect(out.get("pnpm-workspace.yaml")).toBe(buildWorkspaceYaml(REF));
	});

	it("leaves a file it does not own as upstream wrote it", () => {
		expect(out.get("Dockerfile")).toBe("FROM node\n");
	});

	it("does not touch its input", () => {
		expect(files.get("package.json")).toBe(UPSTREAM_PACKAGE_JSON);
		expect(files.has("pnpm-workspace.yaml")).toBe(false);
	});

	it("names the file it could not find when upstream drops one", () => {
		const missing = new Map(files);
		missing.delete("src/main.ts");
		expect(() => applyProvinModules(missing, options)).toThrow(/src\/main\.ts/);
	});

	it("refuses to overwrite a pnpm-workspace.yaml upstream starts to write", () => {
		const taken = new Map(files).set("pnpm-workspace.yaml", "packages: []\n");
		expect(() => applyProvinModules(taken, options)).toThrow(/pnpm-workspace\.yaml/);
	});
});
