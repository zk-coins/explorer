/**
 * Spec 02 — Accumulator (`/accumulator/`).
 */

import { expect, test } from '@playwright/test';
import { mockPublicApi } from './_helpers/network';
import { snap, setViewport } from './_helpers/screenshot';
import { FIXTURE_ACCUMULATOR_RAW } from './_fixtures/publicChain';

test.describe('02 accumulator — functional', () => {
  test('renders size / tip_height / tip_block_hash from fixture', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/accumulator/');

    const view = page.getByTestId('accumulator-view');
    await expect(view).toBeVisible();
    await expect(view).toContainText(FIXTURE_ACCUMULATOR_RAW.size);
    await expect(view).toContainText(FIXTURE_ACCUMULATOR_RAW.tip_height);
    await expect(view).toContainText(FIXTURE_ACCUMULATOR_RAW.tip_block_hash);
  });
});

test.describe('Visual Regression — 02 accumulator', () => {
  test('02-accumulator-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/accumulator/');
    await expect(page.getByTestId('accumulator-view')).toBeVisible();
    await expect(page.getByTestId('accumulator-view')).toContainText(FIXTURE_ACCUMULATOR_RAW.size);
    await expect(page.getByTestId('accumulator-view')).toContainText(
      FIXTURE_ACCUMULATOR_RAW.tip_height,
    );
    await expect(page.getByTestId('accumulator-view')).toContainText(
      FIXTURE_ACCUMULATOR_RAW.tip_block_hash,
    );
    await snap(page, '02-accumulator-desktop');
  });
});
