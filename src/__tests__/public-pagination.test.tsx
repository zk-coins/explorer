/**
 * Public mode cursor pagination honesty: subset counts + load-more surface.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PublicHome } from '@/components/PublicHome';
import {
  FIXTURE_ACCUMULATOR_RAW,
  FIXTURE_INFO_RAW,
  FIXTURE_INSCRIPTIONS_RAW,
} from './fixtures/public-chain';

describe('PublicHome pagination', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('labels loaded subset and loads next cursor page', async () => {
    const page1 = {
      ...FIXTURE_INSCRIPTIONS_RAW,
      next_height: '200',
      next_tx_index: 0,
      next_vin_index: 0,
    };
    const page2 = {
      inscriptions: [
        {
          txid: 'ee'.repeat(32),
          height: '200',
          tx_index: 0,
          vin_index: 0,
          count: 1,
          format: 1,
          confirmation_state: 'completed' as const,
          nullifiers: [
            {
              pubkey: '99'.repeat(32),
              r: '88'.repeat(32),
              state: 'completed' as const,
            },
          ],
        },
      ],
    };

    let inscriptionCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/v1/info')) {
        return { ok: true, json: async () => FIXTURE_INFO_RAW };
      }
      if (u.includes('/v1/chain/accumulator')) {
        return { ok: true, json: async () => FIXTURE_ACCUMULATOR_RAW };
      }
      if (u.includes('/v1/chain/inscriptions')) {
        inscriptionCalls += 1;
        if (u.includes('from_height=200')) {
          return { ok: true, json: async () => page2 };
        }
        return { ok: true, json: async () => page1 };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'missing' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicHome />);

    await waitFor(() => {
      expect(screen.getByTestId('inscription-list')).toBeTruthy();
    });
    expect(screen.getByTestId('pagination-note').textContent).toMatch(/subset|more available/i);
    expect(screen.getAllByTestId('inscription-card')).toHaveLength(2);
    expect(screen.getByTestId('load-more-inscriptions')).toBeTruthy();

    fireEvent.click(screen.getByTestId('load-more-inscriptions'));
    await waitFor(() => {
      expect(screen.getAllByTestId('inscription-card')).toHaveLength(3);
    });
    expect(inscriptionCalls).toBeGreaterThanOrEqual(2);
  });
});
