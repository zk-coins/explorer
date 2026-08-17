/**
 * Fail-closed §7.5 wire parsers — reject negative / non-integer / non-canonical values.
 * u64 fields accept only canonical decimal strings (`0|[1-9][0-9]*`).
 */

import { describe, expect, it } from 'vitest';
import {
  parseAccumulatorResponse,
  parseInfoResponse,
  parseInscriptionsResponse,
  parseNullifierLookupResponse,
} from '@/lib/api/client';
import {
  FIXTURE_INFO,
  FIXTURE_INFO_RAW,
  FIXTURE_INSCRIPTIONS,
  FIXTURE_INSCRIPTIONS_RAW,
  FIXTURE_NULLIFIER_PRESENT,
  FIXTURE_NULLIFIER_PRESENT_RAW,
} from './fixtures/public-chain';

describe('wire parsers fail-closed', () => {
  it('rejects negative / non-integer numeric fields on info (u32) and non-canonical u64', () => {
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, finality_confirmations: -1 })).toThrow(
      /non-negative safe integer/,
    );
    // JSON number for u64 is non-canonical — reject.
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, activation_height: 1.5 })).toThrow(
      /canonical u64 decimal string/,
    );
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, activation_height: 0 })).toThrow(
      /canonical u64 decimal string/,
    );
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, max_blob_bytes: '0' })).toThrow(/> 0/);
    const { max_blob_bytes: _drop, ...noMax } = FIXTURE_INFO_RAW;
    expect(() => parseInfoResponse(noMax)).toThrow(/max_blob_bytes/);
  });

  it('accepts canonical u64 decimal strings including u64::MAX', () => {
    const info = parseInfoResponse(FIXTURE_INFO_RAW);
    expect(info.max_blob_bytes).toBe(1_048_576n);
    expect(info.activation_height).toBe(0n);

    const withMax = parseInfoResponse({
      ...FIXTURE_INFO_RAW,
      activation_height: '18446744073709551615', // 2^64−1
    });
    expect(withMax.activation_height).toBe((1n << 64n) - 1n);

    const acc = parseAccumulatorResponse({
      size: '3',
      root: 'aa'.repeat(32),
      tip_block_hash: 'bb'.repeat(32),
      tip_height: '120',
    });
    expect(acc.size).toBe(3n);
    expect(acc.tip_height).toBe(120n);
  });

  it('rejects leading zeros, empty, and out-of-range u64 strings', () => {
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, activation_height: '01' })).toThrow(
      /canonical u64 decimal string/,
    );
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, activation_height: '' })).toThrow(
      /canonical u64 decimal string/,
    );
    expect(() =>
      parseInfoResponse({ ...FIXTURE_INFO_RAW, activation_height: '18446744073709551616' }),
    ).toThrow(/u64 range/);
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, activation_height: '+0' })).toThrow(
      /canonical u64 decimal string/,
    );
  });

  it('rejects non-canonical hex and count≠nullifiers.length on inscriptions', () => {
    const base = JSON.parse(JSON.stringify(FIXTURE_INSCRIPTIONS_RAW)) as {
      inscriptions: Array<Record<string, unknown>>;
    };
    const badTx = JSON.parse(JSON.stringify(base)) as typeof base;
    badTx.inscriptions[0]!.txid = 'ZZ' + 'aa'.repeat(31);
    expect(() => parseInscriptionsResponse(badTx)).toThrow(/lowercase hex/);

    const badCount = JSON.parse(JSON.stringify(base)) as typeof base;
    badCount.inscriptions[0]!.count = 99;
    expect(() => parseInscriptionsResponse(badCount)).toThrow(/count 99/);

    const badFormat = JSON.parse(JSON.stringify(base)) as typeof base;
    badFormat.inscriptions[0]!.format = 7;
    expect(() => parseInscriptionsResponse(badFormat)).toThrow(/format must be 0/);
  });

  it('rejects audit_path entries that are not 32-byte hex', () => {
    expect(() =>
      parseNullifierLookupResponse({
        ...FIXTURE_NULLIFIER_PRESENT_RAW,
        audit_path: ['not-hex'],
      }),
    ).toThrow(/audit_path\[0\]/);
  });

  it('accepts valid raw fixtures (node wire form) and typed fixtures', () => {
    expect(parseInfoResponse(FIXTURE_INFO_RAW).max_blob_bytes).toBe(1_048_576n);
    expect(parseInscriptionsResponse(FIXTURE_INSCRIPTIONS_RAW).inscriptions).toHaveLength(2);
    expect(parseNullifierLookupResponse(FIXTURE_NULLIFIER_PRESENT_RAW).present).toBe(true);
    // Typed fixtures remain the post-parse shape for map/UI tests.
    expect(FIXTURE_INFO.max_blob_bytes).toBe(1_048_576n);
    expect(FIXTURE_INSCRIPTIONS.inscriptions).toHaveLength(2);
    expect(FIXTURE_NULLIFIER_PRESENT.present).toBe(true);
  });
});
