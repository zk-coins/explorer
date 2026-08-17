/**
 * Bearer-link fixtures with a real envelope and a stubbed proof payload.
 *
 * The envelope is real: ZBE seal/open (AEAD), bech32m encoding, the
 * network id, and all scalars are produced by the explorer's own crypto
 * exports, so the E2E suite exercises the real open/verify paths, not a
 * parallel fake. The inner CoinProof/BalanceAttestation payload fields
 * (`proof`, `inclusionProof`, and similar byte blobs) are deterministic
 * fill-byte stubs (see sampleCoinProof in src/__tests__/fixtures/crypto.ts)
 * — not real zero-knowledge proofs. This is sufficient because the
 * explorer only (de)serializes CoinProof; it never verifies proof
 * validity, so a stub proof exercises every code path the explorer
 * actually runs.
 *
 * Pure / sync — no network.
 */

import { digestToBytes, networkIdRegtest } from '@zkcoins/sdk';
import { sampleCoinProof, fill, validScalar, xOnlyFromSeed } from '@/__tests__/fixtures/crypto';
import { serializeCoinProof } from '@/lib/bundle/coinProof';
import {
  serializeBalanceAttestationV1,
  type BalanceAttestationV1,
} from '@/lib/bundle/balanceAttestation';
import { zbeSeal } from '@/lib/crypto/zbe';
import { encodeHexLower, base64UrlEncodeNoPad } from '@/lib/crypto/bytes';
import { encodeBech32m, EXPLORER_HRPS } from '@/lib/bech32m';
import { FIXTURE_NULLIFIER_PRESENT_RAW } from '@/__tests__/fixtures/public-chain';

export interface TxFragmentFixture {
  /** URL hash including leading `#`, e.g. `#<zkbid>/<zkview>`. */
  fragment: string;
  /** blobId hex → ZBE ciphertext bytes. */
  blossomFixtures: Record<string, Uint8Array>;
  /** pkCreate hex → RAW nullifier-lookup JSON body. */
  nullifierFixtures: Record<string, unknown>;
}

export interface BalanceFragmentFixture {
  fragment: string;
  nullifierFixtures: Record<string, unknown>;
}

export interface AddrFragmentFixture {
  fragment: string;
}

const TX_SEED = 1;
/** Deterministic K_tx for the authorised confirmation fixture. */
const K_TX = fill(32, 0x2b);
/** Deliberately wrong K_tx for the unauthorised contrast (same blob). */
const K_TX_WRONG = fill(32, 0xaa);

function requireLen(bytes: Uint8Array, n: number, label: string): void {
  if (!(bytes instanceof Uint8Array) || bytes.length !== n) {
    throw new Error(
      `bearerCrypto: ${label} must be ${n} bytes, got ${
        bytes instanceof Uint8Array ? bytes.length : typeof bytes
      }`,
    );
  }
}

function buildTxCore(): {
  fragment: string;
  blossomFixtures: Record<string, Uint8Array>;
  nullifierFixtures: Record<string, unknown>;
  blobIdHex: string;
  zkbid: string;
} {
  const cp = sampleCoinProof(TX_SEED);
  const plain = serializeCoinProof(cp);
  const { ciphertext, blobId } = zbeSeal(K_TX, plain);
  requireLen(blobId, 32, 'blobId');

  const blobIdHex = encodeHexLower(blobId);
  const zkbid = encodeBech32m(EXPLORER_HRPS.zkbid, blobId);
  const zkview = encodeBech32m(EXPLORER_HRPS.zkview, K_TX);

  const pkCreateHex = encodeHexLower(cp.creatingNullifier.pkCreate);
  const rCreateHex = encodeHexLower(cp.creatingNullifier.rCreate);

  // Bonus: Path-B present with matching leaf so nullifier_r_match can pass.
  const nullifierFixtures: Record<string, unknown> = {
    [pkCreateHex]: {
      ...FIXTURE_NULLIFIER_PRESENT_RAW,
      leaf: rCreateHex,
    },
  };

  return {
    fragment: `#${zkbid}/${zkview}`,
    blossomFixtures: { [blobIdHex]: ciphertext },
    nullifierFixtures,
    blobIdHex,
    zkbid,
  };
}

/**
 * Build a /tx fragment fixture.
 *
 * - authorised: real CoinProof sealed under K_tx; decrypt + decode succeed.
 * - unauthorised: same ciphertext/blob_id, wrong zkview → zbe_open fails AEAD.
 */
export function buildTxFragment(kind: 'authorised' | 'unauthorised'): TxFragmentFixture {
  if (kind !== 'authorised' && kind !== 'unauthorised') {
    throw new Error(`buildTxFragment: unknown kind ${JSON.stringify(kind)}`);
  }

  const core = buildTxCore();

  if (kind === 'authorised') {
    return {
      fragment: core.fragment,
      blossomFixtures: core.blossomFixtures,
      nullifierFixtures: core.nullifierFixtures,
    };
  }

  requireLen(K_TX_WRONG, 32, 'K_TX_WRONG');
  if (encodeHexLower(K_TX_WRONG) === encodeHexLower(K_TX)) {
    throw new Error('buildTxFragment: unauthorised K_tx must differ from authorised K_tx');
  }
  const wrongView = encodeBech32m(EXPLORER_HRPS.zkview, K_TX_WRONG);
  return {
    fragment: `#${core.zkbid}/${wrongView}`,
    blossomFixtures: core.blossomFixtures,
    nullifierFixtures: core.nullifierFixtures,
  };
}

/**
 * Build a /balance fragment fixture (inline attestation form `i:`).
 *
 * - authorised: subject/asset/network match → those checks pass.
 * - subject-mismatch: subject ≠ fragment address → subject_match fails.
 */
export function buildBalanceFragment(
  kind: 'authorised' | 'subject-mismatch',
): BalanceFragmentFixture {
  if (kind !== 'authorised' && kind !== 'subject-mismatch') {
    throw new Error(`buildBalanceFragment: unknown kind ${JSON.stringify(kind)}`);
  }

  const subject = fill(32, 0x11);
  const fragmentAddress = kind === 'authorised' ? subject.slice() : fill(32, 0x99);
  const assetId = fill(32, 0x22);
  requireLen(subject, 32, 'subject');
  requireLen(fragmentAddress, 32, 'fragmentAddress');
  requireLen(assetId, 32, 'assetId');

  const networkId = digestToBytes(networkIdRegtest());
  requireLen(networkId, 32, 'networkId');

  const att: BalanceAttestationV1 = {
    subject,
    assetId,
    balance: 9_000n,
    navCeiling: fill(32, 0x33),
    sizeCeiling: 100n,
    txid: fill(32, 0x44),
    blockHash: fill(32, 0x55),
    height: 800_000n,
    pkAnchor: xOnlyFromSeed(20),
    rAnchor: xOnlyFromSeed(21),
    networkId,
    proof: fill(80, 0x88),
  };

  const body = serializeBalanceAttestationV1(att);
  const inline = base64UrlEncodeNoPad(body);
  if (inline.length === 0) {
    throw new Error('buildBalanceFragment: inline attestation encoding produced empty string');
  }

  const zkAddr = encodeBech32m(EXPLORER_HRPS.zk, fragmentAddress);
  const assetIdHex = encodeHexLower(assetId);
  const fragment = `#${zkAddr}/${assetIdHex}/i:${inline}`;

  // Default Path-B absent for Pk_anchor is fine; empty map uses network default.
  return {
    fragment,
    nullifierFixtures: {},
  };
}

/**
 * Build a /addr fragment fixture.
 *
 * Without holder-hint / relay URLs, resolveAddressView never mesh-scans
 * (`canScan` is false) and lands on the honest history-not-resolvable state.
 * That is intended, spec-accurate behaviour — not a fixture gap.
 */
export function buildAddrFragment(kind: 'incoming-only' | 'full'): AddrFragmentFixture {
  if (kind !== 'incoming-only' && kind !== 'full') {
    throw new Error(`buildAddrFragment: unknown kind ${JSON.stringify(kind)}`);
  }

  const address = fill(32, 0x09);
  requireLen(address, 32, 'address');
  const zkAddr = encodeBech32m(EXPLORER_HRPS.zk, address);

  let avk: Uint8Array;
  if (kind === 'incoming-only') {
    avk = validScalar(1);
    requireLen(avk, 32, 'ivk');
  } else {
    avk = new Uint8Array(64);
    avk.set(validScalar(3), 0);
    avk.set(validScalar(4), 32);
    requireLen(avk, 64, 'ivk||ovk');
  }

  const zkavk = encodeBech32m(EXPLORER_HRPS.zkavk, avk);
  return { fragment: `#${zkAddr}/${zkavk}` };
}
