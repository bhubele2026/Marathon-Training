import { defineConfig, devices } from "@playwright/test";

// E2E tests run against the live development workflows that are already
// serving the command-center web app and the api-server. The Replit
// shared proxy fronts both at localhost:80, with the web app at "/" and
// the api at "/api". Override with E2E_BASE_URL for other environments
// (e.g. the published deployment domain from $REPLIT_DOMAINS).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:80";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
