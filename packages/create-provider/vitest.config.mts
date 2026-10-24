import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/__tests__/**/*.test.mts"],
		exclude: ["node_modules/**", "dist/**"],
		testTimeout: 30_000,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "json-summary"],
			reportsDirectory: "./coverage",
			include: ["src/**/*.mts"],
			exclude: ["src/**/__tests__/**", "src/**/*.d.mts", "dist/**"],
			all: true,
		},
	},
});
