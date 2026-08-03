/**
 * Runs once before any Playwright worker starts.
 *
 * Builds cryptographically valid bearer-link fixtures once (pure / sync —
 * no network, no browser) and persists them to `e2e/.fixtures/bearer-links.json`
 * so every worker reads byte-identical material.
 *
 * Wired from `playwright.config.ts::globalSetup`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildTxFragment, buildBalanceFragment, buildAddrFragment } from './_fixtures/bearerCrypto';
import { encodeHexLower } from '@/lib/crypto/bytes';

const FIXTURES_DIR = path.join(__dirname, '.fixtures');
const FIXTURES_PATH = path.join(FIXTURES_DIR, 'bearer-links.json');

function hexMap(map: Record<string, Uint8Array>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (!(v instanceof Uint8Array)) {
      throw new Error(`globalSetup: blossom fixture ${k} is not Uint8Array`);
    }
    out[k] = encodeHexLower(v);
  }
  return out;
}

export default async function globalSetup(): Promise<void> {
  const txAuthorised = buildTxFragment('authorised');
  const txUnauthorised = buildTxFragment('unauthorised');
  const balanceAuthorised = buildBalanceFragment('authorised');
  const balanceSubjectMismatch = buildBalanceFragment('subject-mismatch');
  const addrIncomingOnly = buildAddrFragment('incoming-only');
  const addrFull = buildAddrFragment('full');

  if (!txAuthorised.fragment.startsWith('#')) {
    throw new Error('globalSetup: txAuthorised.fragment must start with #');
  }
  if (!txUnauthorised.fragment.startsWith('#')) {
    throw new Error('globalSetup: txUnauthorised.fragment must start with #');
  }
  if (txAuthorised.fragment === txUnauthorised.fragment) {
    throw new Error(
      'globalSetup: authorised and unauthorised tx fragments must differ (wrong zkview)',
    );
  }

  const payload = {
    txAuthorised: {
      fragment: txAuthorised.fragment,
      blossomFixtures: hexMap(txAuthorised.blossomFixtures),
      nullifierFixtures: txAuthorised.nullifierFixtures,
    },
    txUnauthorised: {
      fragment: txUnauthorised.fragment,
      blossomFixtures: hexMap(txUnauthorised.blossomFixtures),
      nullifierFixtures: txUnauthorised.nullifierFixtures,
    },
    balanceAuthorised: {
      fragment: balanceAuthorised.fragment,
      nullifierFixtures: balanceAuthorised.nullifierFixtures,
    },
    balanceSubjectMismatch: {
      fragment: balanceSubjectMismatch.fragment,
      nullifierFixtures: balanceSubjectMismatch.nullifierFixtures,
    },
    addrIncomingOnly: {
      fragment: addrIncomingOnly.fragment,
    },
    addrFull: {
      fragment: addrFull.fragment,
    },
  };

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.writeFileSync(FIXTURES_PATH, JSON.stringify(payload, null, 2));
  console.log(`globalSetup: wrote bearer-link fixtures to ${FIXTURES_PATH}`);
}
