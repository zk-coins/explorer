/**
 * client.ts parser + fetchNullifier / getJson fail-closed arms.
 */

import { describe, expect, it } from 'vitest';
import {
  fetchInfo,
  fetchNullifier,
  parseAccumulatorResponse,
  parseInfoResponse,
  parseInscriptionsResponse,
  parseNullifierLookupResponse,
} from '@/lib/api/client';
import { NodeApiError } from '@/lib/api/types';
import { FIXTURE_INFO_RAW, FIXTURE_NULLIFIER_PRESENT_RAW } from './fixtures/public-chain';

const HEX32 = 'ab'.repeat(32);

describe('client parsers and fetchNullifier', () => {
  it('resolveBase rejects empty baseUrl', async () => {
    await expect(
      fetchInfo({ baseUrl: '', fetchImpl: async () => new Response('{}') }),
    ).rejects.toThrow(/empty/);
  });

  it('getJson wraps network throw, non-ok JSON, non-ok non-JSON, ok invalid JSON', async () => {
    await expect(
      fetchInfo({
        baseUrl: 'https://n.example',
        fetchImpl: async () => {
          throw 'net-down';
        },
      }),
    ).rejects.toMatchObject({ code: 'network_error' });

    await expect(
      fetchInfo({
        baseUrl: 'https://n.example',
        fetchImpl: async () =>
          ({
            ok: false,
            status: 502,
            json: async () => ({ error: 'bad_gateway', message: 'upstream' }),
          }) as unknown as Response,
      }),
    ).rejects.toMatchObject({ code: 'bad_gateway', message: 'upstream' });

    await expect(
      fetchInfo({
        baseUrl: 'https://n.example',
        fetchImpl: async () =>
          ({
            ok: false,
            status: 500,
            json: async () => {
              throw new Error('not json');
            },
          }) as unknown as Response,
      }),
    ).rejects.toMatchObject({ code: 'http_error' });

    await expect(
      fetchInfo({
        baseUrl: 'https://n.example',
        fetchImpl: async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('broken');
            },
          }) as unknown as Response,
      }),
    ).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it('parseInfoResponse rejects unknown network, zero max_blob_bytes, non-string features', () => {
    expect(() => parseInfoResponse(null)).toThrow(/not an object/);
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, network: 'signet' })).toThrow(
      /unknown network/,
    );
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, max_blob_bytes: '0' })).toThrow(
      /max_blob_bytes must be > 0/,
    );
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, features: [1] })).toThrow(
      /features entries must be strings/,
    );
  });

  it('parseInscriptionsResponse cursor and entry validation', () => {
    expect(() => parseInscriptionsResponse(null)).toThrow(/not an object/);
    expect(() =>
      parseInscriptionsResponse({
        inscriptions: [],
        next_height: '1',
        next_tx_index: 0,
        // missing next_vin_index
      }),
    ).toThrow(/pagination cursor/);

    expect(() =>
      parseInscriptionsResponse({
        inscriptions: [
          {
            txid: HEX32,
            height: '1',
            tx_index: 0,
            vin_index: 0,
            count: 1,
            format: 0,
            confirmation_state: 'unknown',
            nullifiers: [{ pubkey: HEX32, r: HEX32, state: 'pending' }],
          },
        ],
      }),
    ).toThrow(/confirmation_state/);

    expect(() =>
      parseInscriptionsResponse({
        inscriptions: [
          {
            txid: HEX32,
            height: '1',
            tx_index: 0,
            vin_index: 0,
            count: 2,
            format: 1,
            confirmation_state: 'pending',
            nullifiers: [{ pubkey: HEX32, r: HEX32, state: 'pending' }],
          },
        ],
      }),
    ).toThrow(/count/);

    expect(() =>
      parseInscriptionsResponse({
        inscriptions: [
          {
            txid: HEX32,
            height: '1',
            tx_index: 0,
            vin_index: 0,
            count: 1,
            format: 9,
            confirmation_state: 'pending',
            nullifiers: [{ pubkey: HEX32, r: HEX32, state: 'pending' }],
          },
        ],
      }),
    ).toThrow(/format/);

    expect(() =>
      parseInscriptionsResponse({
        inscriptions: [
          {
            txid: HEX32,
            height: '1',
            tx_index: 0,
            vin_index: 0,
            count: 2,
            format: 0,
            confirmation_state: 'pending',
            nullifiers: [
              { pubkey: HEX32, r: HEX32, state: 'pending' },
              { pubkey: HEX32, r: HEX32, state: 'pending' },
            ],
          },
        ],
      }),
    ).toThrow(/format 0/);

    expect(() =>
      parseInscriptionsResponse({
        inscriptions: [
          {
            txid: HEX32,
            height: '1',
            tx_index: 0,
            vin_index: 0,
            count: 1,
            format: 1,
            confirmation_state: 'pending',
            nullifiers: [{ pubkey: HEX32, r: HEX32, state: 'weird' }],
          },
        ],
      }),
    ).toThrow(/state must be/);

    expect(() => parseInscriptionsResponse({ inscriptions: [null] })).toThrow(/not an object/);
    expect(() =>
      parseInscriptionsResponse({
        inscriptions: [
          {
            txid: HEX32,
            height: '1',
            tx_index: 0,
            vin_index: 0,
            count: 1,
            format: 1,
            confirmation_state: 'pending',
            nullifiers: [null],
          },
        ],
      }),
    ).toThrow(/not an object/);
  });

  it('parseInscriptionsResponse accepts a full valid cursor', () => {
    const result = parseInscriptionsResponse({
      inscriptions: [],
      next_height: '5',
      next_tx_index: 2,
      next_vin_index: 1,
    });
    expect(result.next_height).toBe(5n);
    expect(result.next_tx_index).toBe(2);
    expect(result.next_vin_index).toBe(1);
  });

  it('parseNullifierLookupResponse missing present and long audit_path', () => {
    expect(() => parseNullifierLookupResponse(null)).toThrow(/not an object/);
    expect(() =>
      parseNullifierLookupResponse({
        audit_path: [],
        tree_size: '1',
        root: HEX32,
        tip_block_hash: HEX32,
        tip_height: '1',
      }),
    ).toThrow(/present/);
    const longPath = Array.from({ length: 65 }, () => HEX32);
    expect(() =>
      parseNullifierLookupResponse({
        present: false,
        audit_path: longPath,
        tree_size: '1',
        root: HEX32,
        tip_block_hash: HEX32,
        tip_height: '1',
      }),
    ).toThrow(/audit_path longer than 64/);
  });

  it('parseAccumulatorResponse rejects non-object', () => {
    expect(() => parseAccumulatorResponse(null)).toThrow(/not an object/);
  });

  it('fetchNullifier rejects empty pubkey and happy path', async () => {
    await expect(
      fetchNullifier('', {
        baseUrl: 'https://n.example',
        fetchImpl: async () => new Response('{}'),
      }),
    ).rejects.toThrow(/pubkey is required/);

    const raw = await fetchNullifier(HEX32, {
      baseUrl: 'https://n.example',
      fetchImpl: async (url) => {
        expect(String(url)).toContain(`/v1/chain/nullifier/${HEX32}`);
        return {
          ok: true,
          status: 200,
          json: async () => FIXTURE_NULLIFIER_PRESENT_RAW,
        } as unknown as Response;
      },
    });
    expect(raw.present).toBe(true);
    expect(raw.position).toBe(0n);
  });

  it('require field helpers surface via parseInfoResponse', () => {
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, protocol_version: '' })).toThrow(
      /empty string/,
    );
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, finality_confirmations: -1 })).toThrow(
      /non-negative safe integer/,
    );
    expect(() =>
      parseInfoResponse({ ...FIXTURE_INFO_RAW, finality_confirmations: 0x1_0000_0000 }),
    ).toThrow(/exceeds max/);
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, activation_height: 1 })).toThrow(
      /canonical u64/,
    );
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, activation_height: '01' })).toThrow(
      /canonical u64/,
    );
    expect(() =>
      parseInfoResponse({
        ...FIXTURE_INFO_RAW,
        activation_height: '18446744073709551616', // 2^64
      }),
    ).toThrow(/u64 range/);
    expect(() => parseInfoResponse({ ...FIXTURE_INFO_RAW, features: 'nope' })).toThrow(/non-array/);
    expect(() =>
      parseInfoResponse({
        ...FIXTURE_INFO_RAW,
      }),
    ).not.toThrow();
    expect(() =>
      parseAccumulatorResponse({
        size: '1',
        root: 'ZZ',
        tip_block_hash: HEX32,
        tip_height: '1',
      }),
    ).toThrow(/64-char lowercase hex/);
    expect(() =>
      parseNullifierLookupResponse({
        present: false,
        audit_path: ['not-hex'],
        tree_size: '1',
        root: HEX32,
        tip_block_hash: HEX32,
        tip_height: '1',
      }),
    ).toThrow(/audit_path\[0\]/);
  });

  it('fetchInscriptions builds query string', async () => {
    const { fetchInscriptions } = await import('@/lib/api/client');
    let seen = '';
    await fetchInscriptions({
      baseUrl: 'https://n.example',
      from_height: 1n,
      from_tx_index: 2,
      from_vin_index: 3,
      limit: 10,
      fetchImpl: async (url) => {
        seen = String(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ inscriptions: [] }),
        } as unknown as Response;
      },
    });
    expect(seen).toMatch(/from_height=1/);
    expect(seen).toMatch(/from_tx_index=2/);
    expect(seen).toMatch(/from_vin_index=3/);
    expect(seen).toMatch(/limit=10/);
  });
});
