import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 7000 },
  reporter: "list",
  globalSetup: "../scripts/e2e-server.mjs",
  use: {
    baseURL: "http://127.0.0.1:18080",
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {},
  },
});
