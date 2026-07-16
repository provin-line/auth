import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/__tests__/**/*.test.mts"],
		// Exclude the bundled template/ — those *.test.mts files belong to
		// generated scaffolds (they import deps like @o3co/ts.hocon that are
		// only resolvable inside a generated instance, not in this package).
		exclude: ["src/template/**", "node_modules/**", "dist/**"],
		// Round-trip + file-emission tests touch tmpdirs and copy template trees;
		// 30 s default per-test cap is generous enough for slow CI runners.
		testTimeout: 30_000,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "json-summary"],
			reportsDirectory: "./coverage",
			include: ["src/**/*.mts"],
			exclude: ["src/**/__tests__/**", "src/**/*.d.mts", "src/template/**", "dist/**"],
			all: true,
		},
	},
});
