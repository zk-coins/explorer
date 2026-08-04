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
  FIXTURE_ACCUMULATOR_RAW,
  FIXTURE_BROKEN_ACCUMULATOR,
  FIXTURE_INFO,
  FIXTURE_INFO_RAW,
  FIXTURE_INSCRIPTIONS,
  FIXTURE_INSCRIPTIONS_RAW,
  FIXTURE_NULLIFIER_PRESENT,
  FIXTURE_NULLIFIER_PRESENT_RAW,
} from './fixtures/public-chain';

describe('Public-mode data mapping (§7.5 → §5.5 view)', () => {
  it('maps normative inscription shapes into Public inscriptions', () => {
    const parsed = parseInscriptionsResponse(FIXTURE_INSCRIPTIONS_RAW);
    const view = mapInscriptions(parsed);
    expect(view).toHaveLength(2);
    expect(view[0]?.nullifiers).toHaveLength(2);
    expect(view[0]?.nullifiers[0]?.state).toBe('completed');
    expect(view[1]?.nullifiers[0]?.state).toBe('failed');
    expect(view[0]?.txid).toBe(FIXTURE_INSCRIPTIONS.inscriptions[0]?.txid);
  });

  it('parseInscriptionsResponse accepts full three-field pagination cursor', () => {
    const parsed = parseInscriptionsResponse({
      ...FIXTURE_INSCRIPTIONS_RAW,
      next_height: '200',
      next_tx_index: 1,
      next_vin_index: 2,
    });
    expect(parsed.next_height).toBe(200n);
    expect(parsed.next_tx_index).toBe(1);
    expect(parsed.next_vin_index).toBe(2);
  });

  it('maps accumulator root as nav_root and computes aggregate counts', () => {
    const acc = mapAccumulator(parseAccumulatorResponse(FIXTURE_ACCUMULATOR_RAW));
    const inscriptions = mapInscriptions(parseInscriptionsResponse(FIXTURE_INSCRIPTIONS_RAW));
    const counts = computeAggregateCounts(inscriptions, acc.size);
    expect(acc.nav_root).toBe(FIXTURE_ACCUMULATOR.root);
    expect(acc.size).toBe(3n);
    expect(counts.inscription_count).toBe(2);
    expect(counts.accumulator_size).toBe(3n);
    expect(counts.transitions_per_block).toEqual([
      { height: 100n, transitions: 2 },
      { height: 101n, transitions: 1 },
    ]);
  });

  it('maps nullifier membership with client-verify caveat', () => {
    const view = mapNullifierLookup(parseNullifierLookupResponse(FIXTURE_NULLIFIER_PRESENT_RAW));
    expect(view.present).toBe(true);
    expect(view.position).toBe(0n);
    expect(view.client_must_verify_against_own_scan).toBe(true);
  });

  it('renders Public components without §5.5-forbidden fields', () => {
    const inscriptions = mapInscriptions(parseInscriptionsResponse(FIXTURE_INSCRIPTIONS_RAW));
    const accumulator = mapAccumulator(parseAccumulatorResponse(FIXTURE_ACCUMULATOR_RAW));
    const info = mapInfo(parseInfoResponse(FIXTURE_INFO_RAW));
    const counts = computeAggregateCounts(inscriptions, accumulator.size);
    const nullifierLookup = mapNullifierLookup(
      parseNullifierLookupResponse(FIXTURE_NULLIFIER_PRESENT_RAW),
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

  it('mapNullifierLookup throws when present:true but position/leaf missing', () => {
    expect(() =>
      mapNullifierLookup({
        present: true,
        audit_path: [],
        tree_size: 1n,
        root: 'aa'.repeat(32),
        tip_block_hash: 'bb'.repeat(32),
        tip_height: 1n,
        // position missing
      }),
    ).toThrow(/position missing/);

    expect(() =>
      mapNullifierLookup({
        present: true,
        position: 0n,
        audit_path: [],
        tree_size: 1n,
        root: 'aa'.repeat(32),
        tip_block_hash: 'bb'.repeat(32),
        tip_height: 1n,
        // leaf missing
      }),
    ).toThrow(/leaf missing/);
  });

  it('mapNullifierLookup maps present:false without position/leaf', () => {
    const view = mapNullifierLookup({
      present: false,
      audit_path: ['cc'.repeat(32)],
      tree_size: 2n,
      root: 'aa'.repeat(32),
      tip_block_hash: 'bb'.repeat(32),
      tip_height: 10n,
    });
    expect(view.present).toBe(false);
    expect(view.position).toBeUndefined();
    expect(view.leaf).toBeUndefined();
    const text = publicViewToSearchableText({
      inscriptions: [],
      accumulator: {
        size: 2n,
        nav_root: 'aa'.repeat(32),
        tip_block_hash: 'bb'.repeat(32),
        tip_height: 10n,
      },
      counts: { inscription_count: 0, transitions_per_block: [], accumulator_size: 2n },
      info: {
        network: 'regtest',
        protocol_version: 'v1',
        finality_confirmations: 6,
        activation_height: 0n,
      },
      nullifierLookup: view,
    });
    expect(text).toContain('lookup_present=false');
    expect(text).not.toContain('lookup_position=');
    expect(text).not.toContain('lookup_leaf=');
  });

  it('computeAggregateCounts aggregates two inscriptions at the same height', () => {
    const inscriptions = mapInscriptions(parseInscriptionsResponse(FIXTURE_INSCRIPTIONS_RAW));
    // Duplicate height 100 with another member count.
    const sameHeight = [
      inscriptions[0]!,
      {
        ...inscriptions[0]!,
        txid: 'ee'.repeat(32),
        count: 3,
        nullifiers: inscriptions[0]!.nullifiers,
      },
      inscriptions[1]!,
    ];
    const counts = computeAggregateCounts(sameHeight, 10n);
    expect(counts.transitions_per_block).toEqual([
      { height: 100n, transitions: 5 },
      { height: 101n, transitions: 1 },
    ]);
  });

  it('InscriptionList empty page and short hex passthrough', () => {
    const emptyCounts = {
      inscription_count: 0,
      transitions_per_block: [] as Array<{ height: bigint; transitions: number }>,
      accumulator_size: 0n,
    };
    const { container } = render(
      <InscriptionList inscriptions={[]} counts={emptyCounts} countsScopeLabel="loaded subset" />,
    );
    expect(screen.getByTestId('inscriptions-empty')).toBeTruthy();
    expect(container.textContent).toContain('—');
    expect(container.textContent).toMatch(/Inscriptions \(loaded subset\)/);

    // shortHex passthrough: hex length ≤ head+tail+1 (default 8+6+1=15).
    const shortIns = mapInscriptions(parseInscriptionsResponse(FIXTURE_INSCRIPTIONS_RAW));
    shortIns[0] = {
      ...shortIns[0]!,
      nullifiers: [
        {
          pubkey: 'aabbccdd',
          r: '112233',
          state: 'pending',
        },
      ],
      count: 1,
    };
    const withMembers = computeAggregateCounts(shortIns, 3n);
    render(<InscriptionList inscriptions={shortIns} counts={withMembers} />);
    expect(screen.getAllByTestId('nullifier-member')[0]?.textContent).toContain('aabbccdd');
  });
});
