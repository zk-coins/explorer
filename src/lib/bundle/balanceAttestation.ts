/**
 * BalanceAttestationV1 — `serialize(BalanceAttestation)` §5.7 / §7.1.
 *
 * Layout:
 *   subject(32) ‖ asset_id(32) ‖ balance(u128-be16) ‖ nav_ceiling(32) ‖
 *   size_ceiling(u64-be8) ‖ txid(32) ‖ block_hash(32) ‖ height(u64-be8) ‖
 *   Pk_anchor(32) ‖ R_anchor(32) ‖ network_id(32) ‖ u32-be len(proof) ‖ proof
 */

import {
  encodeHexLower,
  readU128Be,
  readU32Be,
  readU64Be,
  writeU128Be,
  writeU32Be,
  writeU64Be,
} from '@/lib/crypto/bytes';

export class BalanceAttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BalanceAttestationError';
  }
}

/** Fixed public-input prefix length before the proof length prefix. */
export const BALANCE_ATTESTATION_PUBLIC_PREFIX_LEN =
  32 + // subject
  32 + // asset_id
  16 + // balance
  32 + // nav_ceiling
  8 + // size_ceiling
  32 + // txid
  32 + // block_hash
  8 + // height
  32 + // Pk_anchor
  32 + // R_anchor
  32; // network_id
// = 288

export interface BalanceAttestationV1 {
  subject: Uint8Array;
  assetId: Uint8Array;
  balance: bigint;
  navCeiling: Uint8Array;
  sizeCeiling: bigint;
  txid: Uint8Array;
  blockHash: Uint8Array;
  height: bigint;
  pkAnchor: Uint8Array;
  rAnchor: Uint8Array;
  networkId: Uint8Array;
  proof: Uint8Array;
}

export function deserializeBalanceAttestationV1(bytes: Uint8Array): BalanceAttestationV1 {
  if (!(bytes instanceof Uint8Array)) {
    throw new BalanceAttestationError('body must be a Uint8Array');
  }
  if (bytes.length < BALANCE_ATTESTATION_PUBLIC_PREFIX_LEN + 4) {
    throw new BalanceAttestationError(
      `BalanceAttestationV1 too short: ${bytes.length} < ${BALANCE_ATTESTATION_PUBLIC_PREFIX_LEN + 4}`,
    );
  }
  let o = 0;
  const take = (n: number, ctx: string): Uint8Array => {
    /* v8 ignore next 3 -- take() here is only ever called for the 11 fixed
       288-byte-total prefix fields; the entry guard above already requires
       bytes.length >= 292, so o+n can never exceed bytes.length at these
       call sites */
    if (o + n > bytes.length) {
      throw new BalanceAttestationError(`${ctx}: truncated`);
    }
    const s = bytes.slice(o, o + n);
    o += n;
    return s;
  };

  const subject = take(32, 'subject');
  const assetId = take(32, 'asset_id');
  const balance = readU128Be(take(16, 'balance'), 0);
  const navCeiling = take(32, 'nav_ceiling');
  const sizeCeiling = readU64Be(take(8, 'size_ceiling'), 0);
  const txid = take(32, 'txid');
  const blockHash = take(32, 'block_hash');
  const height = readU64Be(take(8, 'height'), 0);
  const pkAnchor = take(32, 'Pk_anchor');
  const rAnchor = take(32, 'R_anchor');
  const networkId = take(32, 'network_id');

  /* v8 ignore next 3 -- prefix length gate above already requires ≥4 remaining bytes for the proof length */
  if (o + 4 > bytes.length) {
    throw new BalanceAttestationError('missing proof length prefix');
  }
  const proofLen = readU32Be(bytes, o);
  o += 4;
  if (o + proofLen > bytes.length) {
    throw new BalanceAttestationError(
      `proof length prefix ${proofLen} exceeds remaining ${bytes.length - o}`,
    );
  }
  const proof = bytes.slice(o, o + proofLen);
  o += proofLen;
  if (o !== bytes.length) {
    throw new BalanceAttestationError(`trailing bytes after proof: ${bytes.length - o}`);
  }

  return {
    subject,
    assetId,
    balance,
    navCeiling,
    sizeCeiling,
    txid,
    blockHash,
    height,
    pkAnchor,
    rAnchor,
    networkId,
    proof,
  };
}

/** Build a canonical attestation body for tests/fixtures. */
export function serializeBalanceAttestationV1(att: BalanceAttestationV1): Uint8Array {
  /* v8 ignore next 3 -- a >4 GiB proof array is not constructible in a test process */
  if (att.proof.length > 0xffffffff) {
    throw new BalanceAttestationError('proof exceeds u32 length');
  }
  const parts = [
    att.subject,
    att.assetId,
    writeU128Be(att.balance),
    att.navCeiling,
    writeU64Be(att.sizeCeiling),
    att.txid,
    att.blockHash,
    writeU64Be(att.height),
    att.pkAnchor,
    att.rAnchor,
    att.networkId,
    writeU32Be(att.proof.length),
    att.proof,
  ];
  let total = 0;
  for (const p of parts) {
    /* v8 ignore next 3 -- fixed-width fields never empty; empty proof is the only zero-length part */
    if (p.length === 0 && p !== att.proof) {
      // empty proof is allowed; other fields must be present via fixed widths above
    }
    total += p.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function attestationToView(att: BalanceAttestationV1): {
  subjectHex: string;
  assetIdHex: string;
  balance: string;
  navCeilingHex: string;
  sizeCeiling: string;
  txidHex: string;
  blockHashHex: string;
  height: string;
  pkAnchorHex: string;
  rAnchorHex: string;
  networkIdHex: string;
  proofLen: number;
} {
  return {
    subjectHex: encodeHexLower(att.subject),
    assetIdHex: encodeHexLower(att.assetId),
    balance: att.balance.toString(10),
    navCeilingHex: encodeHexLower(att.navCeiling),
    sizeCeiling: att.sizeCeiling.toString(10),
    txidHex: encodeHexLower(att.txid),
    blockHashHex: encodeHexLower(att.blockHash),
    height: att.height.toString(10),
    pkAnchorHex: encodeHexLower(att.pkAnchor),
    rAnchorHex: encodeHexLower(att.rAnchor),
    networkIdHex: encodeHexLower(att.networkId),
    proofLen: att.proof.length,
  };
}
