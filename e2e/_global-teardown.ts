/**
 * Runs once after all workers finish. Unlinks the fixture file unless
 * E2E_KEEP_FIXTURES is set (useful when debugging a flaky run — you can
 * inspect the precomputed bearer material).
 *
 * Wired from `playwright.config.ts::globalTeardown`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURES_PATH = path.join(__dirname, '.fixtures', 'bearer-links.json');

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_FIXTURES === 'true') {
    console.log(`globalTeardown: keeping ${FIXTURES_PATH} (E2E_KEEP_FIXTURES=true)`);
    return;
  }
  if (fs.existsSync(FIXTURES_PATH)) {
    fs.unlinkSync(FIXTURES_PATH);
  }
}
