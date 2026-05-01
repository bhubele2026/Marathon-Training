import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    // Vitest 4 removed `test.poolOptions`; pool-specific options are now
    // top-level. `singleFork` puts every file in one worker process and
    // `fileParallelism: false` runs those files one after another so no two
    // suites ever hit the shared integration database concurrently.
    forks: { singleFork: true },
    fileParallelism: false,
    env: {
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
    },
  },
  resolve: {
    conditions: ["workspace"],
  },
});
