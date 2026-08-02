/**
 * Thin unauthenticated client for the §7.5 Public projection.
 *
 * Endpoints: GET /v1/info, /v1/chain/inscriptions, /v1/chain/accumulator,
 * /v1/chain/nullifier/<pk>. No capability, no bearer secret, no private data.
 *
 * Wire parsers are fail-closed: negative / non-integer / unsafe numbers,
 * non-canonical hex, open format values, and inconsistent counts reject the
 * whole response rather than rendering a seemingly valid UI.
 */

import { NODE_BASE_URL } from '@/lib/config';
import {
  NodeApiError,
  type AccumulatorResponse,
  type ApiErrorBody,
  type InfoResponse,
  type InscriptionsResponse,
  type NullifierLookupResponse,
} from './types';

export interface FetchInscriptionsOpts {
  from_height?: number;
  from_tx_index?: number;
  from_vin_index?: number;
  limit?: number;
  signal?: AbortSignal;
  /** Override base URL (tests). Production callers omit this. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Closed inscription format set (AggregateStateNullifierV3 §3.5). */
const INSCRIPTION_FORMATS = new Set([0, 1]);
const NETWORKS = new Set(['mainnet', 'testnet', 'regtest']);
const NULLIFIER_STATES = new Set(['pending', 'completed', 'failed']);
const CONFIRMATION_STATES = new Set(['pending', 'completed']);

/** Lowercase hex of exactly `byteLen` bytes (2*byteLen chars). */
const HEX32_RE = /^[0-9a-f]{64}$/;

function resolveBase(baseUrl: string | undefined): string {
  if (baseUrl !== undefined) {
    if (baseUrl.length === 0) {
      throw new Error('node base URL must not be empty');
    }
    return baseUrl.replace(/\/+$/, '');
  }
  return NODE_BASE_URL;
}

async function getJson<T>(
  path: string,
  opts: { baseUrl?: string; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<T> {
  const base = resolveBase(opts.baseUrl);
  const url = `${base}${path}`;
  const fetchImpl = opts.fetchImpl !== undefined ? opts.fetchImpl : fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: opts.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new NodeApiError(0, 'network_error', `Failed to reach node: ${msg}`);
  }

  if (!res.ok) {
    let code = 'http_error';
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      if (typeof body.error === 'string' && body.error.length > 0) {
        code = body.error;
      }
      if (typeof body.message === 'string' && body.message.length > 0) {
        message = body.message;
      }
    } catch {
      // Non-JSON error body — keep status-derived message.
    }
    throw new NodeApiError(res.status, code, message);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new NodeApiError(res.status, 'malformed_response', 'Response body is not valid JSON');
  }
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: missing or empty string field "${key}"`,
    );
  }
  return v;
}

/**
 * Non-negative safe integer (u32-compatible width for JSON numbers that must
 * stay exact in JS). Rejects floats, negatives, NaN, and > MAX_SAFE_INTEGER.
 */
function requireNonNegSafeInt(
  obj: Record<string, unknown>,
  key: string,
  ctx: string,
  opts: { max?: number } = {},
): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || !Number.isSafeInteger(v) || v < 0) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: field "${key}" must be a non-negative safe integer, got ${JSON.stringify(v)}`,
    );
  }
  if (opts.max !== undefined && v > opts.max) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: field "${key}" exceeds max ${opts.max}, got ${v}`,
    );
  }
  return v;
}

/**
 * u32 wire field: non-negative safe integer ≤ 0xffffffff.
 */
function requireU32(obj: Record<string, unknown>, key: string, ctx: string): number {
  return requireNonNegSafeInt(obj, key, ctx, { max: 0xffffffff });
}

/**
 * u64-as-JSON number: non-negative safe integer (exact representation only).
 * Values above Number.MAX_SAFE_INTEGER must not be accepted silently.
 */
function requireU64Safe(obj: Record<string, unknown>, key: string, ctx: string): number {
  return requireNonNegSafeInt(obj, key, ctx);
}

function requireArray(obj: Record<string, unknown>, key: string, ctx: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: missing or non-array field "${key}"`,
    );
  }
  return v;
}

/** Canonical 32-byte lowercase hex (64 chars, 0-9a-f only). */
function requireHex32(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = requireString(obj, key, ctx);
  if (!HEX32_RE.test(v)) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: field "${key}" must be 64-char lowercase hex (32 bytes), got length ${v.length}`,
    );
  }
  return v;
}

export function parseInfoResponse(raw: unknown): InfoResponse {
  if (raw === null || typeof raw !== 'object') {
    throw new NodeApiError(200, 'malformed_response', 'info: body is not an object');
  }
  const o = raw as Record<string, unknown>;
  const network = requireString(o, 'network', 'info');
  if (!NETWORKS.has(network)) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `info: unknown network ${JSON.stringify(network)}`,
    );
  }
  const protocol_version = requireString(o, 'protocol_version', 'info');
  const finality_confirmations = requireU32(o, 'finality_confirmations', 'info');
  const activation_height = requireU64Safe(o, 'activation_height', 'info');
  // §7.4 size gate — required; no silent default.
  const max_blob_bytes = requireU64Safe(o, 'max_blob_bytes', 'info');
  if (max_blob_bytes === 0) {
    throw new NodeApiError(200, 'malformed_response', 'info: max_blob_bytes must be > 0');
  }
  const featuresRaw = requireArray(o, 'features', 'info');
  const features: string[] = [];
  for (const f of featuresRaw) {
    if (typeof f !== 'string') {
      throw new NodeApiError(200, 'malformed_response', 'info: features entries must be strings');
    }
    features.push(f);
  }
  return {
    network: network as InfoResponse['network'],
    protocol_version,
    finality_confirmations,
    activation_height,
    max_blob_bytes,
    features,
  };
}

export function parseAccumulatorResponse(raw: unknown): AccumulatorResponse {
  if (raw === null || typeof raw !== 'object') {
    throw new NodeApiError(200, 'malformed_response', 'accumulator: body is not an object');
  }
  const o = raw as Record<string, unknown>;
  return {
    size: requireU64Safe(o, 'size', 'accumulator'),
    root: requireHex32(o, 'root', 'accumulator'),
    tip_block_hash: requireHex32(o, 'tip_block_hash', 'accumulator'),
    tip_height: requireU64Safe(o, 'tip_height', 'accumulator'),
  };
}

export function parseInscriptionsResponse(raw: unknown): InscriptionsResponse {
  if (raw === null || typeof raw !== 'object') {
    throw new NodeApiError(200, 'malformed_response', 'inscriptions: body is not an object');
  }
  const o = raw as Record<string, unknown>;
  const list = requireArray(o, 'inscriptions', 'inscriptions');
  const inscriptions = list.map((item, i) => parseInscriptionEntry(item, i));

  const hasNextH = Object.prototype.hasOwnProperty.call(o, 'next_height');
  const hasNextTx = Object.prototype.hasOwnProperty.call(o, 'next_tx_index');
  const hasNextVin = Object.prototype.hasOwnProperty.call(o, 'next_vin_index');
  const cursorCount = (hasNextH ? 1 : 0) + (hasNextTx ? 1 : 0) + (hasNextVin ? 1 : 0);
  if (cursorCount !== 0 && cursorCount !== 3) {
    throw new NodeApiError(
      200,
      'malformed_response',
      'inscriptions: pagination cursor must include all three of next_height, next_tx_index, next_vin_index, or none',
    );
  }

  const result: InscriptionsResponse = { inscriptions };
  if (cursorCount === 3) {
    result.next_height = requireU64Safe(o, 'next_height', 'inscriptions');
    result.next_tx_index = requireU32(o, 'next_tx_index', 'inscriptions');
    result.next_vin_index = requireU32(o, 'next_vin_index', 'inscriptions');
  }
  return result;
}

function parseInscriptionEntry(
  raw: unknown,
  index: number,
): InscriptionsResponse['inscriptions'][number] {
  const ctx = `inscriptions[${index}]`;
  if (raw === null || typeof raw !== 'object') {
    throw new NodeApiError(200, 'malformed_response', `${ctx}: not an object`);
  }
  const o = raw as Record<string, unknown>;
  const nullifiersRaw = requireArray(o, 'nullifiers', ctx);
  const nullifiers = nullifiersRaw.map((n, j) =>
    parseNullifierMember(n, `${ctx}.nullifiers[${j}]`),
  );
  const confirmation_state = requireString(o, 'confirmation_state', ctx);
  if (!CONFIRMATION_STATES.has(confirmation_state)) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: confirmation_state must be pending|completed, got ${JSON.stringify(confirmation_state)}`,
    );
  }
  const count = requireU32(o, 'count', ctx);
  if (count !== nullifiers.length) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: count ${count} !== nullifiers.length ${nullifiers.length}`,
    );
  }
  const format = requireU32(o, 'format', ctx);
  if (!INSCRIPTION_FORMATS.has(format)) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: format must be 0 (raw) or 1 (half-aggregated), got ${format}`,
    );
  }
  if (format === 0 && count !== 1) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: format 0 (raw) requires count === 1, got ${count}`,
    );
  }
  return {
    txid: requireHex32(o, 'txid', ctx),
    height: requireU64Safe(o, 'height', ctx),
    tx_index: requireU32(o, 'tx_index', ctx),
    vin_index: requireU32(o, 'vin_index', ctx),
    count,
    format,
    nullifiers,
    confirmation_state: confirmation_state as 'pending' | 'completed',
  };
}

function parseNullifierMember(
  raw: unknown,
  ctx: string,
): { pubkey: string; r: string; state: 'pending' | 'completed' | 'failed' } {
  if (raw === null || typeof raw !== 'object') {
    throw new NodeApiError(200, 'malformed_response', `${ctx}: not an object`);
  }
  const o = raw as Record<string, unknown>;
  const state = requireString(o, 'state', ctx);
  if (!NULLIFIER_STATES.has(state)) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: state must be pending|completed|failed, got ${JSON.stringify(state)}`,
    );
  }
  return {
    pubkey: requireHex32(o, 'pubkey', ctx),
    r: requireHex32(o, 'r', ctx),
    state: state as 'pending' | 'completed' | 'failed',
  };
}

export function parseNullifierLookupResponse(raw: unknown): NullifierLookupResponse {
  if (raw === null || typeof raw !== 'object') {
    throw new NodeApiError(200, 'malformed_response', 'nullifier: body is not an object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.present !== 'boolean') {
    throw new NodeApiError(200, 'malformed_response', 'nullifier: missing boolean field "present"');
  }
  const auditRaw = requireArray(o, 'audit_path', 'nullifier');
  const audit_path: string[] = [];
  for (let i = 0; i < auditRaw.length; i++) {
    const h = auditRaw[i];
    if (typeof h !== 'string' || !HEX32_RE.test(h)) {
      throw new NodeApiError(
        200,
        'malformed_response',
        `nullifier: audit_path[${i}] must be 64-char lowercase hex`,
      );
    }
    audit_path.push(h);
  }
  if (audit_path.length > 64) {
    throw new NodeApiError(200, 'malformed_response', 'nullifier: audit_path longer than 64');
  }

  const base: NullifierLookupResponse = {
    present: o.present,
    audit_path,
    tree_size: requireU64Safe(o, 'tree_size', 'nullifier'),
    root: requireHex32(o, 'root', 'nullifier'),
    tip_block_hash: requireHex32(o, 'tip_block_hash', 'nullifier'),
    tip_height: requireU64Safe(o, 'tip_height', 'nullifier'),
  };

  if (o.present) {
    base.position = requireU64Safe(o, 'position', 'nullifier (present)');
    base.leaf = requireHex32(o, 'leaf', 'nullifier (present)');
  }
  return base;
}

export async function fetchInfo(
  opts: {
    baseUrl?: string;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<InfoResponse> {
  const raw = await getJson<unknown>('/v1/info', opts);
  return parseInfoResponse(raw);
}

export async function fetchAccumulator(
  opts: {
    baseUrl?: string;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<AccumulatorResponse> {
  const raw = await getJson<unknown>('/v1/chain/accumulator', opts);
  return parseAccumulatorResponse(raw);
}

export async function fetchInscriptions(
  opts: FetchInscriptionsOpts = {},
): Promise<InscriptionsResponse> {
  const params = new URLSearchParams();
  if (opts.from_height !== undefined) {
    params.set('from_height', String(opts.from_height));
  }
  if (opts.from_tx_index !== undefined) {
    params.set('from_tx_index', String(opts.from_tx_index));
  }
  if (opts.from_vin_index !== undefined) {
    params.set('from_vin_index', String(opts.from_vin_index));
  }
  if (opts.limit !== undefined) {
    params.set('limit', String(opts.limit));
  }
  const qs = params.toString();
  const path = qs.length > 0 ? `/v1/chain/inscriptions?${qs}` : '/v1/chain/inscriptions';
  const raw = await getJson<unknown>(path, opts);
  return parseInscriptionsResponse(raw);
}

export async function fetchNullifier(
  pubkey: string,
  opts: { baseUrl?: string; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<NullifierLookupResponse> {
  if (typeof pubkey !== 'string' || pubkey.length === 0) {
    throw new Error('fetchNullifier: pubkey is required');
  }
  // Path segment only — never a query, never a fragment secret.
  const path = `/v1/chain/nullifier/${encodeURIComponent(pubkey)}`;
  const raw = await getJson<unknown>(path, opts);
  return parseNullifierLookupResponse(raw);
}
