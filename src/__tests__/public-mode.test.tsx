import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InscriptionList } from '@/components/InscriptionList';
import { AccumulatorPanel } from '@/components/AccumulatorView';
import {
  parseAccumulatorResponse,
  parseInscriptionsResponse,
  parseInfoResponse,
  parseNullifierLookupResponse,
} from '@/lib/api/client';
import {
  computeAggregateCounts,
  mapAccumulator,
  mapInfo,
  mapInscriptions,
  mapNullifierLookup,
  PUBLIC_MODE_FORBIDDEN_FIELD_NAMES,
  publicViewToSearchableText,
} from '@/lib/api/map';
import {
  FIXTURE_ACCUMULATOR,
  FIXTURE_BROKEN_ACCUMULATOR,
  FIXTURE_INFO,
  FIXTURE_INSCRIPTIONS,
  FIXTURE_NULLIFIER_PRESENT,
} from './fixtures/public-chain';

describe('Public-mode data mapping (§7.5 → §5.5 view)', () => {
  it('maps normative inscription shapes into Public inscriptions', () => {
    const parsed = parseInscriptionsResponse(FIXTURE_INSCRIPTIONS);
    const view = mapInscriptions(parsed);
    expect(view).toHaveLength(2);
    expect(view[0]?.nullifiers).toHaveLength(2);
    expect(view[0]?.nullifiers[0]?.state).toBe('completed');
    expect(view[1]?.nullifiers[0]?.state).toBe('failed');
    expect(view[0]?.txid).toBe(FIXTURE_INSCRIPTIONS.inscriptions[0]?.txid);
  });

  it('maps accumulator root as nav_root and computes aggregate counts', () => {
    const acc = mapAccumulator(parseAccumulatorResponse(FIXTURE_ACCUMULATOR));
    const inscriptions = mapInscriptions(parseInscriptionsResponse(FIXTURE_INSCRIPTIONS));
    const counts = computeAggregateCounts(inscriptions, acc.size);
    expect(acc.nav_root).toBe(FIXTURE_ACCUMULATOR.root);
    expect(acc.size).toBe(3);
    expect(counts.inscription_count).toBe(2);
    expect(counts.accumulator_size).toBe(3);
    expect(counts.transitions_per_block).toEqual([
      { height: 100, transitions: 2 },
      { height: 101, transitions: 1 },
    ]);
  });

  it('maps nullifier membership with client-verify caveat', () => {
    const view = mapNullifierLookup(parseNullifierLookupResponse(FIXTURE_NULLIFIER_PRESENT));
    expect(view.present).toBe(true);
    expect(view.position).toBe(0);
    expect(view.client_must_verify_against_own_scan).toBe(true);
  });

  it('renders Public components without §5.5-forbidden fields', () => {
    const inscriptions = mapInscriptions(parseInscriptionsResponse(FIXTURE_INSCRIPTIONS));
    const accumulator = mapAccumulator(parseAccumulatorResponse(FIXTURE_ACCUMULATOR));
    const info = mapInfo(parseInfoResponse(FIXTURE_INFO));
    const counts = computeAggregateCounts(inscriptions, accumulator.size);
    const nullifierLookup = mapNullifierLookup(
      parseNullifierLookupResponse(FIXTURE_NULLIFIER_PRESENT),
    );

    const { container } = render(
      <div>
        <InscriptionList inscriptions={inscriptions} counts={counts} />
        <AccumulatorPanel accumulator={accumulator} info={info} />
      </div>,
    );

    // Structural Public fields must appear.
    expect(screen.getByTestId('inscription-list')).toBeTruthy();
    expect(screen.getByTestId('aggregate-counts')).toBeTruthy();
    expect(screen.getAllByTestId('inscription-card').length).toBe(2);
    expect(screen.getAllByTestId('nullifier-member').length).toBe(3);
    expect(screen.getByTestId('accumulator-view')).toBeTruthy();
    expect(container.textContent).toContain('AggregateStateNullifierV3');
    expect(container.textContent).toContain('nav_root');

    // View-model keys must not include any §5.5-forbidden field name.
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== 'object') {
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item);
        }
        return;
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        keys.add(k);
        walk(v);
      }
    };
    walk({ inscriptions, accumulator, counts, info, nullifierLookup });
    for (const token of PUBLIC_MODE_FORBIDDEN_FIELD_NAMES) {
      expect(keys.has(token), `forbidden key on view model: ${token}`).toBe(false);
    }

    // Flatten mapped Public view + rendered DOM for forbidden-token scan.
    const searchable = [
      publicViewToSearchableText({
        inscriptions,
        accumulator,
        counts,
        info,
        nullifierLookup,
      }),
      container.textContent ?? '',
    ].join('\n');

    // §5.5 MUST NOT display these. Also rejects retired BatchInscription wording.
    for (const token of PUBLIC_MODE_FORBIDDEN_FIELD_NAMES) {
      // Word-boundary-ish check: token as whole word / field name.
      const re = new RegExp(`(^|[^A-Za-z0-9_])${token}([^A-Za-z0-9_]|$)`);
      expect(re.test(searchable), `forbidden token leaked: ${token}`).toBe(false);
    }
  });

  it('rejects a broken accumulator response instead of inventing defaults', () => {
    expect(() => parseAccumulatorResponse(FIXTURE_BROKEN_ACCUMULATOR)).toThrow(/root/);
  });
});
