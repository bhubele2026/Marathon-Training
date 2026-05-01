import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    // Vitest 4 removed `test.poolOptions`; pool-specific options are now
    // top-level. `singleFork` keeps integration tests in one worker so they
    // don't race on the shared database.
    forks: { singleFork: true },
    env: {
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
    },
  },
  resolve: {
    conditions: ["workspace"],
  },
});
