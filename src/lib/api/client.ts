/**
 * Thin unauthenticated client for the §7.5 Public projection.
 *
 * Endpoints: GET /v1/info, /v1/chain/inscriptions, /v1/chain/accumulator,
 * /v1/chain/nullifier/<pk>. No capability, no bearer secret, no private data.
 */

import { NODE_BASE_URL } from '@/lib/config';
import { expectPresent } from '@/lib/expectPresent';
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

function requireNumber(obj: Record<string, unknown>, key: string, ctx: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new NodeApiError(
      200,
      'malformed_response',
      `${ctx}: missing or non-numeric field "${key}"`,
    );
  }
  return v;
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

const NETWORKS = new Set(['mainnet', 'testnet', 'regtest']);
const NULLIFIER_STATES = new Set(['pending', 'completed', 'failed']);
const CONFIRMATION_STATES = new Set(['pending', 'completed']);

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
  const finality_confirmations = requireNumber(o, 'finality_confirmations', 'info');
  const activation_height = requireNumber(o, 'activation_height', 'info');
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
    features,
  };
}

export function parseAccumulatorResponse(raw: unknown): AccumulatorResponse {
  if (raw === null || typeof raw !== 'object') {
    throw new NodeApiError(200, 'malformed_response', 'accumulator: body is not an object');
  }
  const o = raw as Record<string, unknown>;
  return {
    size: requireNumber(o, 'size', 'accumulator'),
    root: requireString(o, 'root', 'accumulator'),
    tip_block_hash: requireString(o, 'tip_block_hash', 'accumulator'),
    tip_height: requireNumber(o, 'tip_height', 'accumulator'),
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
    result.next_height = requireNumber(o, 'next_height', 'inscriptions');
    result.next_tx_index = requireNumber(o, 'next_tx_index', 'inscriptions');
    result.next_vin_index = requireNumber(o, 'next_vin_index', 'inscriptions');
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
  return {
    txid: requireString(o, 'txid', ctx),
    height: requireNumber(o, 'height', ctx),
    tx_index: requireNumber(o, 'tx_index', ctx),
    vin_index: requireNumber(o, 'vin_index', ctx),
    count: requireNumber(o, 'count', ctx),
    format: requireNumber(o, 'format', ctx),
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
    pubkey: requireString(o, 'pubkey', ctx),
    r: requireString(o, 'r', ctx),
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
  for (const h of auditRaw) {
    if (typeof h !== 'string') {
      throw new NodeApiError(
        200,
        'malformed_response',
        'nullifier: audit_path entries must be hex strings',
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
    tree_size: requireNumber(o, 'tree_size', 'nullifier'),
    root: requireString(o, 'root', 'nullifier'),
    tip_block_hash: requireString(o, 'tip_block_hash', 'nullifier'),
    tip_height: requireNumber(o, 'tip_height', 'nullifier'),
  };

  if (o.present) {
    base.position = requireNumber(o, 'position', 'nullifier (present)');
    base.leaf = requireString(o, 'leaf', 'nullifier (present)');
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

/** Re-export for tests that assert presence of the fail-closed helper. */
export { expectPresent };
