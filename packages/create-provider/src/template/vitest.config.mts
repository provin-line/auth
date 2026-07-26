import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Discover tests from both `src/__tests__/` (co-located unit tests)
		// and top-level `tests/` (integration tests). Excludes dist/ so stale
		// build outputs from a prior `tsc` run don't cause duplicate failures.
		include: [
			"src/**/__tests__/**/*.test.mts",
			"tests/**/*.test.mts",
		],
		// The scaffold ships without tests (consumers add their own), so a
		// fresh `pnpm test` must succeed rather than fail on zero matches.
		passWithNoTests: true,
	},
});
