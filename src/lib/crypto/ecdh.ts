/**
 * BIP-340 x-only ECDH — §1.1 / §1.3.
 *
 * `ss = x(k · lift_x(P))` with even-y lift. Used to re-derive K_tx from ivk+epk
 * for address-view decryption.
 *
 * Matches the node `ecdh_shared_x` construction (even-y lift_x, x-coordinate
 * of the shared point).
 */

import { schnorr } from '@noble/curves/secp256k1.js';

const Point = schnorr.Point;
const liftX = schnorr.utils.lift_x;
const { Fn } = Point;

export class EcdhError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcdhError';
  }
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

/**
 * `ECDH(scalar, peer_xonly) = x(scalar · lift_x(peer_xonly))`.
 * Both scalar and peer_xonly are 32-byte big-endian encodings.
 */
export function ecdhSharedX(scalar: Uint8Array, peerXonly: Uint8Array): Uint8Array {
  if (!(scalar instanceof Uint8Array) || scalar.length !== 32) {
    throw new EcdhError(
      `scalar must be 32 bytes, got ${scalar instanceof Uint8Array ? scalar.length : typeof scalar}`,
    );
  }
  if (!(peerXonly instanceof Uint8Array) || peerXonly.length !== 32) {
    throw new EcdhError(
      `peer x-only must be 32 bytes, got ${peerXonly instanceof Uint8Array ? peerXonly.length : typeof peerXonly}`,
    );
  }

  const d = bytesToBigint(scalar);
  if (d === 0n || d >= Fn.ORDER) {
    throw new EcdhError('scalar is not in [1, n)');
  }

  let peer: ReturnType<typeof liftX>;
  try {
    peer = liftX(bytesToBigint(peerXonly));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EcdhError(`peer x-only is not a valid curve point: ${msg}`);
  }

  /* v8 ignore next 6 -- multiply fails only if lift_x returned a non-multipliable point, which noble does not expose for valid lifts */
  try {
    const shared = peer.multiply(d);
    // Compressed SEC1 is 0x02/0x03 ‖ x; x-only is the x coordinate alone.
    return shared.toBytes(true).slice(1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EcdhError(`ECDH multiply failed: ${msg}`);
  }
}

/** Receiver-side: `ss = ECDH(ivk, epk)`. */
export function sharedSecretReceiver(ivk: Uint8Array, epk: Uint8Array): Uint8Array {
  return ecdhSharedX(ivk, epk);
}
