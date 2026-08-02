/**
 * §5.7 balance attestation decode + checklist honesty.
 */

import { describe, expect, it } from 'vitest';
import {
  serializeBalanceAttestationV1,
  type BalanceAttestationV1,
} from '@/lib/bundle/balanceAttestation';
import { verifyBalanceAttestationBytes } from '@/lib/bearer/balance';
import { base64UrlEncodeNoPad, encodeHexLower } from '@/lib/crypto/bytes';
import { sha256 } from '@/lib/crypto/sha256';
import type { BalanceFragmentOk } from '@/lib/fragments';
import { digestToBytes, networkIdRegtest } from '@zkcoins/sdk';

function fill(n: number, v: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => v);
}

function sampleAttestation(): BalanceAttestationV1 {
  return {
    subject: fill(32, 0x11),
    assetId: fill(32, 0x22),
    balance: 9_000n,
    navCeiling: fill(32, 0x33),
    sizeCeiling: 100n,
    txid: fill(32, 0x44),
    blockHash: fill(32, 0x55),
    height: 800_000n,
    pkAnchor: fill(32, 0x66),
    rAnchor: fill(32, 0x77),
    networkId: digestToBytes(networkIdRegtest()),
    proof: fill(80, 0x88),
  };
}

function fragmentFor(att: BalanceAttestationV1): BalanceFragmentOk {
  return {
    status: 'ok',
    kind: 'balance',
    address: att.subject.slice(),
    assetIdHex: encodeHexLower(att.assetId),
    attestationForm: 'inline',
    attestationInline: base64UrlEncodeNoPad(serializeBalanceAttestationV1(att)),
  };
}

describe('§5.7 balance attestation', () => {
  it('decodes and matches subject/asset/network; proof/nav/anchor are open', () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const frag = fragmentFor(att);

    const view = verifyBalanceAttestationBytes(body, frag, { network: 'regtest' });
    expect(view.fatalError).toBeUndefined();
    expect(view.fields?.balance).toBe('9000');
    expect(view.fields?.subjectHex).toBe(encodeHexLower(att.subject));

    const byId = Object.fromEntries(view.checks.map((c) => [c.id, c]));
    expect(byId['decode']?.status).toBe('pass');
    expect(byId['subject_match']?.status).toBe('pass');
    expect(byId['asset_match']?.status).toBe('pass');
    expect(byId['network_id']?.status).toBe('pass');
    // Honest open steps — never claimed verified:
    expect(byId['c_balance_proof']?.status).toBe('open');
    expect(byId['nav_ceiling_canonical']?.status).toBe('open');
    expect(byId['anchor_first_occurrence']?.status).toBe('open');
  });

  it('fails subject mismatch', () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const frag = fragmentFor(att);
    frag.address = fill(32, 0x99);

    const view = verifyBalanceAttestationBytes(body, frag, { network: 'regtest' });
    expect(view.checks.find((c) => c.id === 'subject_match')?.status).toBe('fail');
  });

  it('fails handle hash mismatch', () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const wrongHandle = sha256(new Uint8Array([1, 2, 3]));
    const frag = fragmentFor(att);
    frag.attestationForm = 'handle';
    frag.attestationHandle = wrongHandle;

    const view = verifyBalanceAttestationBytes(body, frag, {
      network: 'regtest',
      expectedHandle: wrongHandle,
    });
    expect(view.checks.find((c) => c.id === 'handle_hash')?.status).toBe('fail');
    expect(view.fatalError).toMatch(/handle mismatch/);
  });

  it('passes handle hash when body matches zkatt payload', () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const handle = sha256(body);
    const frag = fragmentFor(att);
    frag.attestationForm = 'handle';
    frag.attestationHandle = handle;

    const view = verifyBalanceAttestationBytes(body, frag, {
      network: 'regtest',
      expectedHandle: handle,
    });
    expect(view.checks.find((c) => c.id === 'handle_hash')?.status).toBe('pass');
  });
});
