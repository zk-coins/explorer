/**
 * `serialize(CoinProof)` / deserialize — §1.5 / §7.1.
 *
 * Length-prefixed concatenation in declaration order. After width parsing,
 * digests, x-only curve points, and (when asset_terms is present) asset_id
 * recomputation are validated. Opaque Plonky2 proof bytes are still not
 * verified in-browser — that remains an open step.
 */

import {
  assetIdV1,
  assetIdV2,
  digestFromBytes,
  digestToBytes,
  digestsEqual,
  GENESIS_TAG,
  liftXOnly,
} from '@zkcoins/sdk';
import {
  encodeHexLower,
  readU128Be,
  readU32Be,
  readU64Be,
  writeU128Be,
  writeU32Be,
  writeU64Be,
} from '@/lib/crypto/bytes';
import { sha256 } from '@/lib/crypto/sha256';

export const COIN_WIRE_LEN = 112;
export const MAX_ASSET_NAME_LEN = 255;

export class CoinProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoinProofError';
  }
}

export interface Coin {
  identifier: Uint8Array;
  recipient: Uint8Array;
  amount: bigint;
  assetId: Uint8Array;
}

export interface CreatingNullifier {
  pkCreate: Uint8Array;
  rCreate: Uint8Array;
  rPrimeCreate: Uint8Array;
}

export interface NavOpening {
  size: bigint;
  mth: Uint8Array;
  navRand: Uint8Array;
}

export interface IssuanceTerms {
  creatorPubkey: Uint8Array;
  decimals: number;
  issuanceVersion: number;
  name: Uint8Array;
  capTotal?: bigint;
  termsSalt?: Uint8Array;
}

export interface CoinProof {
  coin: Coin;
  proof: Uint8Array;
  inclusionProof: Uint8Array;
  creatingPrevAsh: Uint8Array;
  creatingNullifier: CreatingNullifier;
  navOpening: NavOpening;
  assetTerms?: IssuanceTerms;
  epk: Uint8Array;
  ciphertext: Uint8Array;
  detectTag: Uint8Array;
}

class Cursor {
  private offset = 0;
  constructor(private readonly buf: Uint8Array) {}

  remaining(): number {
    return this.buf.length - this.offset;
  }

  take(n: number, ctx: string): Uint8Array {
    if (n < 0 || this.offset + n > this.buf.length) {
      throw new CoinProofError(`${ctx}: truncated (need ${n}, have ${this.remaining()})`);
    }
    const slice = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  takeU32Bytes(ctx: string): Uint8Array {
    if (this.remaining() < 4) {
      throw new CoinProofError(`${ctx}: missing length prefix`);
    }
    const len = readU32Be(this.buf, this.offset);
    this.offset += 4;
    return this.take(len, ctx);
  }

  done(ctx: string): void {
    if (this.remaining() !== 0) {
      throw new CoinProofError(`${ctx}: trailing bytes ${this.remaining()}`);
    }
  }
}

export function serializeCoin(coin: Coin): Uint8Array {
  if (coin.identifier.length !== 32) {
    throw new CoinProofError('coin.identifier must be 32 bytes');
  }
  if (coin.recipient.length !== 32) {
    throw new CoinProofError('coin.recipient must be 32 bytes');
  }
  if (coin.assetId.length !== 32) {
    throw new CoinProofError('coin.assetId must be 32 bytes');
  }
  const out = new Uint8Array(COIN_WIRE_LEN);
  out.set(coin.identifier, 0);
  out.set(coin.recipient, 32);
  out.set(writeU128Be(coin.amount), 64);
  out.set(coin.assetId, 80);
  return out;
}

export function deserializeCoin(bytes: Uint8Array): Coin {
  if (bytes.length !== COIN_WIRE_LEN) {
    throw new CoinProofError(`serialize(Coin) must be ${COIN_WIRE_LEN} bytes, got ${bytes.length}`);
  }
  return {
    identifier: bytes.slice(0, 32),
    recipient: bytes.slice(32, 64),
    amount: readU128Be(bytes, 64),
    assetId: bytes.slice(80, 112),
  };
}

function readIssuanceTerms(cur: Cursor): IssuanceTerms {
  const creatorPubkey = cur.take(32, 'asset_terms.creator_pubkey');
  const decimals = cur.take(1, 'asset_terms.decimals')[0]!;
  const issuanceVersion = cur.take(1, 'asset_terms.issuance_version')[0]!;
  const name = cur.takeU32Bytes('asset_terms.name');
  if (name.length > MAX_ASSET_NAME_LEN) {
    throw new CoinProofError(
      `asset_terms.name length ${name.length} exceeds ${MAX_ASSET_NAME_LEN}`,
    );
  }
  if (issuanceVersion === 1) {
    return { creatorPubkey, decimals, issuanceVersion, name };
  }
  if (issuanceVersion === 2) {
    const capRaw = cur.take(16, 'asset_terms.cap_total');
    const termsSalt = cur.take(32, 'asset_terms.terms_salt');
    return {
      creatorPubkey,
      decimals,
      issuanceVersion,
      name,
      capTotal: readU128Be(capRaw, 0),
      termsSalt,
    };
  }
  throw new CoinProofError(`asset_terms.issuance_version invalid: ${issuanceVersion}`);
}

function writeIssuanceTerms(terms: IssuanceTerms): Uint8Array {
  if (terms.name.length > MAX_ASSET_NAME_LEN) {
    throw new CoinProofError(
      `asset_terms.name length ${terms.name.length} exceeds ${MAX_ASSET_NAME_LEN}`,
    );
  }
  const parts: Uint8Array[] = [
    terms.creatorPubkey,
    new Uint8Array([terms.decimals]),
    new Uint8Array([terms.issuanceVersion]),
    writeU32Be(terms.name.length),
    terms.name,
  ];
  if (terms.issuanceVersion === 1) {
    if (terms.capTotal !== undefined || terms.termsSalt !== undefined) {
      throw new CoinProofError('issuance_version 1 must not carry cap_total/terms_salt');
    }
  } else if (terms.issuanceVersion === 2) {
    if (terms.capTotal === undefined || terms.termsSalt === undefined) {
      throw new CoinProofError('issuance_version 2 requires cap_total and terms_salt');
    }
    parts.push(writeU128Be(terms.capTotal));
    parts.push(terms.termsSalt);
  } else {
    throw new CoinProofError(`asset_terms.issuance_version invalid: ${terms.issuanceVersion}`);
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Reject bytes that are not a canonical Poseidon Digest encoding. */
function requireCanonicalDigest(bytes: Uint8Array, field: string): void {
  try {
    digestFromBytes(bytes);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CoinProofError(`${field}: non-canonical digest: ${detail}`);
  }
}

/** Reject x-only pubkeys / nonces that do not lift to a secp256k1 point. */
function requireXOnlyPoint(bytes: Uint8Array, field: string): void {
  try {
    liftXOnly(bytes, field);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CoinProofError(`${field}: invalid x-only curve point: ${detail}`);
  }
}

/**
 * Recompute asset_id from asset_terms and require equality with coin.assetId.
 * Spec §1.4 / §1.5 — name is never trusted without this binding.
 */
export function assertAssetIdMatchesTerms(coin: Coin, terms: IssuanceTerms): void {
  const nameHash = sha256(terms.name);
  let expected: ReturnType<typeof assetIdV1>;
  if (terms.issuanceVersion === 1) {
    expected = assetIdV1(
      GENESIS_TAG,
      terms.creatorPubkey,
      nameHash,
      terms.decimals,
      terms.issuanceVersion,
    );
  } else if (terms.issuanceVersion === 2) {
    if (terms.capTotal === undefined || terms.termsSalt === undefined) {
      throw new CoinProofError('asset_terms v2 missing cap_total or terms_salt');
    }
    expected = assetIdV2(
      GENESIS_TAG,
      terms.creatorPubkey,
      nameHash,
      terms.decimals,
      terms.issuanceVersion,
      terms.capTotal,
      terms.termsSalt,
    );
  } else {
    throw new CoinProofError(`asset_terms.issuance_version invalid: ${terms.issuanceVersion}`);
  }
  const expectedBytes = digestToBytes(expected);
  const actual = digestFromBytes(coin.assetId);
  if (!digestsEqual(actual, expected)) {
    throw new CoinProofError(
      `coin.asset_id ${encodeHexLower(coin.assetId)} ≠ recompute(asset_terms) ${encodeHexLower(expectedBytes)}`,
    );
  }
}

/** Structural + semantic validation after width-correct decode. */
export function validateCoinProofSemantics(cp: CoinProof): void {
  // Poseidon digests: limbs must be < Goldilocks p (canonical encoding).
  requireCanonicalDigest(cp.coin.identifier, 'coin.identifier');
  requireCanonicalDigest(cp.coin.assetId, 'coin.asset_id');
  requireCanonicalDigest(cp.creatingPrevAsh, 'creating_prev_ash');
  requireCanonicalDigest(cp.navOpening.mth, 'nav_opening.mth');
  requireCanonicalDigest(cp.detectTag, 'detect_tag');
  // coin.recipient is an address (H(Pk₀ ‖ nk_commit)), not a curve point.
  // nav_rand is an opaque 32-byte secret — width already enforced by take().
  // R'_create is the x-only S2C pre-nonce point and MUST lift.

  // X-only curve points on the nullifier / delivery / S2C path.
  requireXOnlyPoint(cp.creatingNullifier.pkCreate, 'creating_nullifier.Pk');
  requireXOnlyPoint(cp.creatingNullifier.rCreate, 'creating_nullifier.R');
  requireXOnlyPoint(cp.creatingNullifier.rPrimeCreate, "creating_nullifier.R'");
  requireXOnlyPoint(cp.epk, 'epk');

  if (cp.assetTerms !== undefined) {
    requireXOnlyPoint(cp.assetTerms.creatorPubkey, 'asset_terms.creator_pubkey');
    assertAssetIdMatchesTerms(cp.coin, cp.assetTerms);
  }
}

/** Deserialize canonical CoinProof bytes. Rejects trailing bytes, width, and semantic errors. */
export function deserializeCoinProof(bytes: Uint8Array): CoinProof {
  const cur = new Cursor(bytes);
  const coin = deserializeCoin(cur.take(COIN_WIRE_LEN, 'CoinProof.coin'));
  const proof = cur.takeU32Bytes('CoinProof.proof');
  const inclusionProof = cur.takeU32Bytes('CoinProof.inclusion_proof');
  const creatingPrevAsh = cur.take(32, 'CoinProof.creating_prev_ash');
  const creatingNullifier: CreatingNullifier = {
    pkCreate: cur.take(32, 'creating_nullifier.Pk'),
    rCreate: cur.take(32, 'creating_nullifier.R'),
    rPrimeCreate: cur.take(32, "creating_nullifier.R'"),
  };
  const sizeRaw = cur.take(8, 'nav_opening.size');
  const navOpening: NavOpening = {
    size: readU64Be(sizeRaw, 0),
    mth: cur.take(32, 'nav_opening.mth'),
    navRand: cur.take(32, 'nav_opening.nav_rand'),
  };
  const presence = cur.take(1, 'asset_terms.presence')[0]!;
  let assetTerms: IssuanceTerms | undefined;
  if (presence === 0x00) {
    assetTerms = undefined;
  } else if (presence === 0x01) {
    assetTerms = readIssuanceTerms(cur);
  } else {
    throw new CoinProofError(`asset_terms.presence invalid: ${presence}`);
  }
  const epk = cur.take(32, 'CoinProof.epk');
  const ciphertext = cur.takeU32Bytes('CoinProof.ciphertext');
  const detectTag = cur.take(32, 'CoinProof.detect_tag');
  cur.done('CoinProof');

  const result: CoinProof = {
    coin,
    proof,
    inclusionProof,
    creatingPrevAsh,
    creatingNullifier,
    navOpening,
    epk,
    ciphertext,
    detectTag,
  };
  if (assetTerms !== undefined) {
    result.assetTerms = assetTerms;
  }
  validateCoinProofSemantics(result);
  return result;
}

/** Serialize for test fixtures. */
export function serializeCoinProof(cp: CoinProof): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(serializeCoin(cp.coin));
  parts.push(writeU32Be(cp.proof.length), cp.proof);
  parts.push(writeU32Be(cp.inclusionProof.length), cp.inclusionProof);
  parts.push(cp.creatingPrevAsh);
  parts.push(cp.creatingNullifier.pkCreate);
  parts.push(cp.creatingNullifier.rCreate);
  parts.push(cp.creatingNullifier.rPrimeCreate);
  parts.push(writeU64Be(cp.navOpening.size));
  parts.push(cp.navOpening.mth);
  parts.push(cp.navOpening.navRand);
  if (cp.assetTerms === undefined) {
    parts.push(new Uint8Array([0x00]));
  } else {
    parts.push(new Uint8Array([0x01]));
    parts.push(writeIssuanceTerms(cp.assetTerms));
  }
  parts.push(cp.epk);
  parts.push(writeU32Be(cp.ciphertext.length), cp.ciphertext);
  parts.push(cp.detectTag);

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** View helpers for UI. */
export function coinToView(coin: Coin): {
  identifierHex: string;
  recipientHex: string;
  amount: string;
  assetIdHex: string;
} {
  return {
    identifierHex: encodeHexLower(coin.identifier),
    recipientHex: encodeHexLower(coin.recipient),
    amount: coin.amount.toString(10),
    assetIdHex: encodeHexLower(coin.assetId),
  };
}
