import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only run tests from src/; exclude dist/ so stale build outputs from a
    // prior `tsc` run don't cause duplicate or phantom test failures (e.g.
    // a renamed/deleted *.test.mts whose `dist/*.test.mjs` still exists).
    include: ["src/**/*.test.mts"],
  },
});
