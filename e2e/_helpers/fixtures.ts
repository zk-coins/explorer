/**
 * Fixture access: read the bearer-link material that `_global-setup.ts`
 * persisted to `e2e/.fixtures/bearer-links.json`.
 *
 * Specs must call `readBearerLinks()` — never recompute crypto in a worker
 * (avoids drift across parallel workers).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TxLinkFixture {
  fragment: string;
  /** blobId hex → ciphertext hex. */
  blossomFixtures: Record<string, string>;
  nullifierFixtures: Record<string, unknown>;
}

export interface BalanceLinkFixture {
  fragment: string;
  nullifierFixtures: Record<string, unknown>;
}

export interface AddrLinkFixture {
  fragment: string;
}

export interface BearerLinks {
  txAuthorised: TxLinkFixture;
  txUnauthorised: TxLinkFixture;
  balanceAuthorised: BalanceLinkFixture;
  balanceSubjectMismatch: BalanceLinkFixture;
  addrIncomingOnly: AddrLinkFixture;
  addrFull: AddrLinkFixture;
}

const FIXTURES_PATH = path.join(__dirname, '..', '.fixtures', 'bearer-links.json');

/**
 * Read the fixture file globalSetup wrote. Throws if absent — that means
 * globalSetup didn't run, which is a configuration error, not a test bug.
 */
export function readBearerLinks(): BearerLinks {
  if (!fs.existsSync(FIXTURES_PATH)) {
    throw new Error(
      `Fixture file missing: ${FIXTURES_PATH}. ` +
        `Did playwright.config.ts forget to wire globalSetup?`,
    );
  }
  const raw = fs.readFileSync(FIXTURES_PATH, 'utf-8');
  let parsed: BearerLinks;
  try {
    parsed = JSON.parse(raw) as BearerLinks;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Fixture file at ${FIXTURES_PATH} is not valid JSON: ${detail}`);
  }
  if (
    typeof parsed.txAuthorised?.fragment !== 'string' ||
    typeof parsed.txUnauthorised?.fragment !== 'string' ||
    typeof parsed.balanceAuthorised?.fragment !== 'string' ||
    typeof parsed.addrIncomingOnly?.fragment !== 'string' ||
    typeof parsed.addrFull?.fragment !== 'string'
  ) {
    throw new Error(`Fixture file at ${FIXTURES_PATH} is malformed: ${raw.slice(0, 200)}`);
  }
  return parsed;
}

/** Decode blossom fixture hex map back to Uint8Array for route mocks. */
export function blossomBytesFromHex(hexMap: Record<string, string>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [id, hex] of Object.entries(hexMap)) {
    if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0) {
      throw new Error(`blossomBytesFromHex: invalid hex for blob ${id}`);
    }
    if (!/^[0-9a-f]+$/.test(hex)) {
      throw new Error(`blossomBytesFromHex: non-lowercase-hex for blob ${id}`);
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    out[id] = bytes;
  }
  return out;
}
