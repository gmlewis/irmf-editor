import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: process.env.CI ? 60000 : 30000,
  reporter: 'list',
  expect: {
    timeout: process.env.CI ? 30000 : 15000,
  },
  use: {
    baseURL: 'http://localhost:1234',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--hide-scrollbars'
      ]
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'cd ../.. && ./build.sh && cd tests/e2e && bun run server.ts',
    url: 'http://localhost:1234',
    reuseExistingServer: !process.env.CI,
  },
})
