import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "8080";
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    // Phone and tablet run only the responsive spec. Both use Chromium with
    // the device's viewport/touch emulation so no extra browser download is
    // needed; the layout under test is CSS-driven, not engine-specific.
    {
      name: "phone",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
      testMatch: /mobile\.spec\.ts/,
    },
    {
      name: "tablet",
      use: { ...devices["iPad (gen 7)"], browserName: "chromium" },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  // When E2E_EXTERNAL=1 the server was started by hand (e.g. docker compose).
  // Otherwise boot the Python backend in-place, serving the built SPA.
  webServer: process.env.E2E_EXTERNAL
    ? undefined
    : {
        command:
          "cd ../backend && STATIC_DIR=../frontend/dist " +
          "uvicorn app.main:app --host 127.0.0.1 --port " + port,
        url: baseURL + "/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
