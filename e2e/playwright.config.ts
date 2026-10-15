import { defineConfig, devices } from "@playwright/test";
import { baseURL, externalTarget } from "./playwright/support";

// Playwright otherwise saves an accessibility snapshot on failure, including revealed invites.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const chromiumLaunch = process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH }
  : {};

export default defineConfig({
  testDir: "./playwright",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 7000 },
  reporter: "list",
  globalSetup: externalTarget ? undefined : "../scripts/e2e-server.mjs",
  use: {
    baseURL,
    ignoreHTTPSErrors: false,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", launchOptions: chromiumLaunch },
    },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        browserName: "chromium",
        launchOptions: chromiumLaunch,
      },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
