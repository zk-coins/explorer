/**
 * Fail-closed §7.5 wire parsers — reject negative / non-integer / non-canonical values.
 */

import { describe, expect, it } from 'vitest';
import {
  parseInfoResponse,
  parseInscriptionsResponse,
  parseNullifierLookupResponse,
} from '@/lib/api/client';
import {
  FIXTURE_INFO,
  FIXTURE_INSCRIPTIONS,
  FIXTURE_NULLIFIER_PRESENT,
} from './fixtures/public-chain';

describe('wire parsers fail-closed', () => {
  it('rejects negative / non-integer numeric fields on info', () => {
    expect(() => parseInfoResponse({ ...FIXTURE_INFO, finality_confirmations: -1 })).toThrow(
      /non-negative safe integer/,
    );
    expect(() => parseInfoResponse({ ...FIXTURE_INFO, activation_height: 1.5 })).toThrow(
      /non-negative safe integer/,
    );
    expect(() => parseInfoResponse({ ...FIXTURE_INFO, max_blob_bytes: 0 })).toThrow(/> 0/);
    const { max_blob_bytes: _drop, ...noMax } = FIXTURE_INFO;
    expect(() => parseInfoResponse(noMax)).toThrow(/max_blob_bytes/);
  });

  it('rejects non-canonical hex and count≠nullifiers.length on inscriptions', () => {
    const base = structuredClone(FIXTURE_INSCRIPTIONS);
    const badTx = structuredClone(base);
    badTx.inscriptions[0]!.txid = 'ZZ' + 'aa'.repeat(31);
    expect(() => parseInscriptionsResponse(badTx)).toThrow(/lowercase hex/);

    const badCount = structuredClone(base);
    badCount.inscriptions[0]!.count = 99;
    expect(() => parseInscriptionsResponse(badCount)).toThrow(/count 99/);

    const badFormat = structuredClone(base);
    badFormat.inscriptions[0]!.format = 7;
    expect(() => parseInscriptionsResponse(badFormat)).toThrow(/format must be 0/);
  });

  it('rejects audit_path entries that are not 32-byte hex', () => {
    expect(() =>
      parseNullifierLookupResponse({
        ...FIXTURE_NULLIFIER_PRESENT,
        audit_path: ['not-hex'],
      }),
    ).toThrow(/audit_path\[0\]/);
  });

  it('accepts valid fixtures', () => {
    expect(parseInfoResponse(FIXTURE_INFO).max_blob_bytes).toBe(1_048_576);
    expect(parseInscriptionsResponse(FIXTURE_INSCRIPTIONS).inscriptions).toHaveLength(2);
    expect(parseNullifierLookupResponse(FIXTURE_NULLIFIER_PRESENT).present).toBe(true);
  });
});
