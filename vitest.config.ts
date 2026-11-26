import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Integration suites share the seeded database and temporarily change treasury policy.
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
  },
});
