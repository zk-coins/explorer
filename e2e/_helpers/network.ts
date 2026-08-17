/**
 * Playwright route mocks for the explorer's single upstream (NEXT_PUBLIC_NODE_BASE_URL).
 *
 * Install before every navigation. Never hits a real network: the fixture origin
 * is intentionally unresolvable.
 */

import type { Page, Route } from '@playwright/test';
import {
  E2E_NODE_BASE_URL,
  FIXTURE_INFO_RAW,
  FIXTURE_ACCUMULATOR_RAW,
  FIXTURE_INSCRIPTIONS_PAGE1_RAW,
  FIXTURE_INSCRIPTIONS_PAGE2_RAW,
  FIXTURE_INSCRIPTIONS_PAGE1_CURSOR,
} from '../_fixtures/publicChain';

export { E2E_NODE_BASE_URL };

export interface MockPublicApiOptions {
  /** Override RAW /v1/info body (or a Response-like override). */
  info?: unknown;
  /** Override RAW /v1/chain/accumulator body. */
  accumulator?: unknown;
  /**
   * Inscriptions behaviour:
   * - undefined: page1 (with cursor) then page2 when from_* matches cursor
   * - 'empty': always `{ inscriptions: [] }`
   * - object: fulfil that body for every inscriptions request
   * - function: custom per-request body
   */
  inscriptions?: 'empty' | unknown | ((url: URL) => unknown);
  /**
   * HTTP status for inscriptions (default 200). Use with a body for error specs.
   */
  inscriptionsStatus?: number;
  /**
   * HTTP status for info (default 200).
   */
  infoStatus?: number;
  /**
   * HTTP status for accumulator (default 200).
   */
  accumulatorStatus?: number;
  /**
   * pk hex → RAW nullifier-lookup JSON. Only configured keys are served;
   * unconfigured keys fail loud with HTTP 599 (no silent absent default).
   */
  nullifiers?: Record<string, unknown>;
  /** blobId hex → raw ciphertext bytes. Missing keys → 404. */
  blossom?: Record<string, Uint8Array>;
  /**
   * Gate that every matched node-route fulfil() awaits before responding.
   * Build one with createRequestGate(), pass `gate.promise` here, and call
   * `gate.release()` only after asserting whatever the test needs to
   * observe while the request is still pending. Deterministic — no
   * wall-clock delay.
   */
  gate?: Promise<void>;
}

/** A plain deferred promise for holding a mocked response open on demand. */
export function createRequestGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function isNodeOrigin(url: URL): boolean {
  const base = new URL(E2E_NODE_BASE_URL);
  return url.origin === base.origin;
}

async function maybeAwaitGate(gate: Promise<void> | undefined): Promise<void> {
  if (gate === undefined) {
    return;
  }
  await gate;
}

function parseBlossomHex(pathname: string): string | null {
  // /blossom/<64-hex>
  const m = pathname.match(/^\/blossom\/([0-9a-fA-F]{64})\/?$/);
  if (m === null || m[1] === undefined) {
    return null;
  }
  return m[1].toLowerCase();
}

function parseNullifierPk(pathname: string): string | null {
  // /v1/chain/nullifier/<pk>
  const m = pathname.match(/^\/v1\/chain\/nullifier\/([0-9a-fA-F]{64})\/?$/);
  if (m === null || m[1] === undefined) {
    return null;
  }
  return m[1].toLowerCase();
}

function isKnownPath(path: string): boolean {
  return (
    path === '/v1/info' ||
    path === '/v1/info/' ||
    path === '/v1/chain/accumulator' ||
    path === '/v1/chain/accumulator/' ||
    path === '/v1/chain/inscriptions' ||
    path === '/v1/chain/inscriptions/' ||
    parseNullifierPk(path) !== null ||
    parseBlossomHex(path) !== null
  );
}

function isFirstInscriptionsPage(url: URL): boolean {
  const fromH = url.searchParams.get('from_height');
  const fromTx = url.searchParams.get('from_tx_index');
  const fromVin = url.searchParams.get('from_vin_index');
  return fromH === null && fromTx === null && fromVin === null;
}

function isSecondInscriptionsPage(url: URL): boolean {
  return (
    url.searchParams.get('from_height') === FIXTURE_INSCRIPTIONS_PAGE1_CURSOR.next_height &&
    url.searchParams.get('from_tx_index') ===
      String(FIXTURE_INSCRIPTIONS_PAGE1_CURSOR.next_tx_index) &&
    url.searchParams.get('from_vin_index') ===
      String(FIXTURE_INSCRIPTIONS_PAGE1_CURSOR.next_vin_index)
  );
}

/**
 * Install page.route handlers for the fixture node origin.
 * Call as the very first step of every spec, before page.goto.
 */
export async function mockPublicApi(
  page: Page,
  overrides: MockPublicApiOptions = {},
): Promise<void> {
  const nullifiers = overrides.nullifiers !== undefined ? overrides.nullifiers : {};
  const blossom = overrides.blossom !== undefined ? overrides.blossom : {};
  const gate = overrides.gate;

  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    let url: URL;
    try {
      url = new URL(req.url());
    } catch {
      await route.continue();
      return;
    }

    if (!isNodeOrigin(url)) {
      // Local static app assets (baseURL) pass through.
      await route.continue();
      return;
    }

    await maybeAwaitGate(gate);

    const path = url.pathname;

    if (isKnownPath(path) && req.method() !== 'GET') {
      await route.fulfill({
        status: 599,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'e2e_unexpected_method',
          message: `E2E mock only serves GET for ${path}, got ${req.method()}`,
        }),
      });
      return;
    }

    // GET /v1/info
    if (path === '/v1/info' || path === '/v1/info/') {
      const status = overrides.infoStatus !== undefined ? overrides.infoStatus : 200;
      const body = overrides.info !== undefined ? overrides.info : FIXTURE_INFO_RAW;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }

    // GET /v1/chain/accumulator
    if (path === '/v1/chain/accumulator' || path === '/v1/chain/accumulator/') {
      const status = overrides.accumulatorStatus !== undefined ? overrides.accumulatorStatus : 200;
      const body =
        overrides.accumulator !== undefined ? overrides.accumulator : FIXTURE_ACCUMULATOR_RAW;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }

    // GET /v1/chain/inscriptions
    if (path === '/v1/chain/inscriptions' || path === '/v1/chain/inscriptions/') {
      const status =
        overrides.inscriptionsStatus !== undefined ? overrides.inscriptionsStatus : 200;
      let body: unknown;
      if (overrides.inscriptions === 'empty') {
        body = { inscriptions: [] };
      } else if (typeof overrides.inscriptions === 'function') {
        body = overrides.inscriptions(url);
      } else if (overrides.inscriptions !== undefined) {
        body = overrides.inscriptions;
      } else if (isFirstInscriptionsPage(url)) {
        body = FIXTURE_INSCRIPTIONS_PAGE1_RAW;
      } else if (isSecondInscriptionsPage(url)) {
        body = FIXTURE_INSCRIPTIONS_PAGE2_RAW;
      } else {
        await route.fulfill({
          status: 599,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'e2e_unconfigured_cursor',
            message: `E2E mock has no configured inscriptions page for cursor ${url.search}`,
          }),
        });
        return;
      }
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }

    // GET /v1/chain/nullifier/<pk>
    const pk = parseNullifierPk(path);
    if (pk !== null) {
      if (!Object.prototype.hasOwnProperty.call(nullifiers, pk) || nullifiers[pk] === undefined) {
        // Unconfigured pk — fail loud instead of silently defaulting to the
        // absent fixture, so a fixture-key typo surfaces as a test failure. A
        // test that wants the explicit "not present" case must configure it:
        // nullifiers: { [pk]: FIXTURE_NULLIFIER_ABSENT_RAW }.
        await route.fulfill({
          status: 599,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'e2e_unconfigured_nullifier',
            message: `E2E mock has no configured nullifier fixture for pk ${pk}`,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(nullifiers[pk]),
      });
      return;
    }

    // GET /blossom/<sha256>
    const blobHex = parseBlossomHex(path);
    if (blobHex !== null) {
      const bytes = blossom[blobHex];
      if (bytes === undefined) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'not_found', message: `blob ${blobHex} not found` }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.from(bytes),
      });
      return;
    }

    // Unhandled node path — fail loudly so a missing mock is visible.
    await route.fulfill({
      status: 599,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'e2e_unmocked',
        message: `E2E mock has no handler for ${req.method()} ${path}`,
      }),
    });
  });
}
