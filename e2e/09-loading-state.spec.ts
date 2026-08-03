/**
 * Spec 09 — Capture the transient LoadingState on `/accumulator/`.
 *
 * Holds the node response behind a deferred gate so the loading UI is
 * captured deterministically, regardless of runner speed — no wall-clock
 * delay, no reliance on retries to paper over flakiness. The test releases
 * the gate only after asserting the loading state and taking the
 * screenshot.
 */

import { expect, test } from '@playwright/test';
import { createRequestGate, mockPublicApi } from './_helpers/network';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Visual Regression — 09 loading state', () => {
  test('09-loading-state', async ({ page }) => {
    await setViewport(page, 'desktop');
    const gate = createRequestGate();
    await mockPublicApi(page, { gate: gate.promise });

    const nav = page.goto('/accumulator/');
    await expect(page.getByTestId('loading-state')).toBeVisible({ timeout: 5_000 });
    await snap(page, '09-loading-state');

    gate.release();
    await nav;
    await expect(page.getByTestId('accumulator-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('loading-state')).toHaveCount(0);
  });
});
