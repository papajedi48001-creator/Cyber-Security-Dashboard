import { defineConfig, devices } from "@playwright/test";
import { E2E_ENV } from "./e2e/env";

// Browser role flows for the Plan 2 UAT. Requires `npm run build` and a
// disposable MariaDB in DATABASE_URL (the e2e users are created there).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3100",
    // The hospital reverse proxy sets X-Real-IP; here it marks the browser as on the management VLAN.
    extraHTTPHeaders: { "x-real-ip": "192.0.2.10" },
    trace: "retain-on-failure",
    // Lets a machine with a preinstalled Chromium skip `playwright install`.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: {
    // next.config uses output: "standalone", which serves static assets only when copied beside it.
    command: "cp -r .next/static .next/standalone/.next/ && node .next/standalone/server.js",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { ...E2E_ENV, PORT: "3100", HOSTNAME: "127.0.0.1" },
  },
});
