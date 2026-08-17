import { defineConfig, devices } from '@playwright/test';
import { E2E_NODE_BASE_URL } from './e2e/_fixtures/publicChain';

/**
 * Explorer E2E — pure static-export reader.
 *
 * Builds+serves the static export locally and intercepts the single
 * upstream dependency (NEXT_PUBLIC_NODE_BASE_URL) with Playwright route
 * mocks. Never hits a real node.
 */

const baseURL = 'http://127.0.0.1:3091';

export default defineConfig({
  testDir: './e2e',
  // Helpers, fixtures, and global-setup files live under e2e/ but should
  // not be picked up as tests. Underscore-prefixed files
  // (`_global-setup.ts`, `_helpers/*.ts`, `_fixtures/*.ts`) are excluded
  // by the `*.spec.ts` glob — do not add an explicit testIgnore for them.
  testMatch: ['*.spec.ts'],
  globalSetup: require.resolve('./e2e/_global-setup.ts'),
  globalTeardown: require.resolve('./e2e/_global-teardown.ts'),
  timeout: 30_000,
  retries: 1,
  fullyParallel: true,
  reporter: [['html', { open: 'never' }]],

  webServer: {
    // Static export build + font fetch can be slow on cold CI runners.
    command: 'npm run build && npm start',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Distinct from CI's https://ci-node.example.invalid so logs never
      // confuse the two dummy origins. Every browser request to this origin
      // is intercepted by page.route() before it leaves the browser.
      NEXT_PUBLIC_NODE_BASE_URL: E2E_NODE_BASE_URL,
    },
  },

  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      // Visual regression only in chromium — functional tests in firefox.
      grep: /^(?!.*Visual Regression)/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /^(?!.*Visual Regression)/,
    },
  ],
});
