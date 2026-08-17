/**
 * Spec 08 — Force ErrorState on a Public-mode page via malformed accumulator.
 */

import { expect, test } from '@playwright/test';
import { mockPublicApi } from './_helpers/network';
import { snap, setViewport } from './_helpers/screenshot';
import { FIXTURE_BROKEN_ACCUMULATOR } from './_fixtures/publicChain';

test.describe('08 error state — functional', () => {
  test('malformed accumulator surfaces error-state', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page, {
      accumulator: FIXTURE_BROKEN_ACCUMULATOR,
    });
    await page.goto('/accumulator/');
    await expect(page.getByTestId('error-state')).toBeVisible();
    await expect(page.getByTestId('error-state')).toContainText(/malformed|root|missing/i);
  });
});

test.describe('Visual Regression — 08 error state', () => {
  test('08-error-state', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page, {
      accumulator: FIXTURE_BROKEN_ACCUMULATOR,
    });
    await page.goto('/accumulator/');
    await expect(page.getByTestId('error-state')).toBeVisible();
    await expect(page.getByTestId('error-state')).toContainText(/malformed|root|missing/i);
    await snap(page, '08-error-state');
  });
});
