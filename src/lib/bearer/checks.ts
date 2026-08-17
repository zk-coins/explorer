/**
 * Explicit check rendering model for §5.6–§5.8.
 *
 * Every check the explorer can run is pass/fail.
 * Every check it cannot run is an open step — never a "verified" badge.
 */

export type CheckStatus = 'pass' | 'fail' | 'open';

export interface CheckItem {
  /** Stable machine id for tests. */
  id: string;
  /** Human label. */
  label: string;
  status: CheckStatus;
  /** Detail / failure reason / open-step explanation. */
  detail: string;
}

export function pass(id: string, label: string, detail: string): CheckItem {
  return { id, label, status: 'pass', detail };
}

export function fail(id: string, label: string, detail: string): CheckItem {
  return { id, label, status: 'fail', detail };
}

export function open(id: string, label: string, detail: string): CheckItem {
  return { id, label, status: 'open', detail };
}
