import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PublicHome } from '@/components/PublicHome';
import { AccumulatorPageClient } from '@/components/AccumulatorPageClient';
import {
  fetchAccumulator,
  fetchInfo,
  fetchInscriptions,
  parseInscriptionsResponse,
} from '@/lib/api/client';
import { NodeApiError } from '@/lib/api/types';

describe('API failure surfaces as error state (never empty success)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PublicHome shows ErrorState when fetch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicHome />);

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeTruthy();
    });
    expect(screen.getByTestId('error-state').textContent).toMatch(/Failed to load public data/i);
    expect(screen.queryByTestId('inscription-list')).toBeNull();
  });

  it('PublicHome shows ErrorState on non-OK HTTP JSON error body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'dependency_unavailable', message: 'scanner not ready' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicHome />);

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeTruthy();
    });
    expect(screen.getByTestId('error-state').textContent).toMatch(
      /dependency_unavailable|scanner not ready/,
    );
    expect(screen.queryByTestId('inscription-list')).toBeNull();
  });

  it('AccumulatorPageClient shows ErrorState on malformed body', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/v1/info')) {
        return {
          ok: true,
          json: async () => ({
            network: 'regtest',
            protocol_version: 'v1',
            finality_confirmations: 6,
            activation_height: 0,
            features: [],
          }),
        };
      }
      // Broken accumulator: missing root
      return {
        ok: true,
        json: async () => ({ size: 1, tip_block_hash: 'aa'.repeat(32), tip_height: 1 }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccumulatorPageClient />);

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeTruthy();
    });
    expect(screen.queryByTestId('accumulator-view')).toBeNull();
  });

  it('client helpers throw NodeApiError on network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      fetchInfo({ baseUrl: 'https://node.example', fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(NodeApiError);
    await expect(
      fetchAccumulator({ baseUrl: 'https://node.example', fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(NodeApiError);
    await expect(
      fetchInscriptions({ baseUrl: 'https://node.example', fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(NodeApiError);
  });

  it('parseInscriptionsResponse rejects partial pagination cursor', () => {
    expect(() =>
      parseInscriptionsResponse({
        inscriptions: [],
        next_height: 1,
        // missing next_tx_index and next_vin_index
      }),
    ).toThrow(/pagination cursor/);
  });
});
