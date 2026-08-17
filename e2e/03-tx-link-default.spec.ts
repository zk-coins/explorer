/**
 * Spec 03 — Confirmation link (`/tx/`) without / with malformed fragment.
 *
 * Route is BearerRoutePanel kind="tx" — NOT an inscription list.
 */

import { expect, test } from '@playwright/test';
import { mockPublicApi } from './_helpers/network';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('03 tx link default — functional', () => {
  test('empty fragment shows grammar hint', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/tx/');
    const empty = page.getByTestId('fragment-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('/tx#<zkbid>/<zkview>');
  });

  test('malformed fragment shows error-state', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/tx/#not-a-valid-fragment');
    await expect(page.getByTestId('error-state')).toBeVisible();
  });
});

test.describe('Visual Regression — 03 tx link default', () => {
  test('03-tx-empty', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/tx/');
    await expect(page.getByTestId('fragment-empty')).toBeVisible();
    await expect(page.getByTestId('fragment-empty')).toContainText('/tx#<zkbid>/<zkview>');
    await snap(page, '03-tx-empty');
  });

  test('03-tx-malformed', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/tx/#not-a-valid-fragment');
    await expect(page.getByTestId('error-state')).toBeVisible();
    await snap(page, '03-tx-malformed');
  });
});
