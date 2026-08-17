/**
 * Spec 05 — Balance attestation link (`/balance/`).
 */

import { expect, test } from '@playwright/test';
import { mockPublicApi } from './_helpers/network';
import { snap, setViewport } from './_helpers/screenshot';
import { readBearerLinks } from './_helpers/fixtures';

test.describe('05 balance link — functional', () => {
  test('empty fragment shows grammar hint', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/balance/');
    const empty = page.getByTestId('fragment-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('/balance#<zk-address>/<asset_id>/h:<zkatt>');
  });

  test('authorised inline attestation passes subject/asset/network checks', async ({ page }) => {
    const { balanceAuthorised } = readBearerLinks();
    await setViewport(page, 'desktop');
    await mockPublicApi(page, {
      nullifiers: balanceAuthorised.nullifierFixtures,
    });
    await page.goto(`/balance/${balanceAuthorised.fragment}`);
    await expect(page.getByTestId('balance-attestation-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('attestation-fields')).toBeVisible();
    await expect(page.getByTestId('check-list')).toBeVisible();
    await expect(page.getByTestId('check-subject_match')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('check-asset_match')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('check-network_id')).toHaveAttribute('data-status', 'pass');
  });
});

test.describe('Visual Regression — 05 balance link', () => {
  test('05-balance-empty', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/balance/');
    await expect(page.getByTestId('fragment-empty')).toBeVisible();
    await snap(page, '05-balance-empty');
  });

  test('05-balance-authorised', async ({ page }) => {
    const { balanceAuthorised } = readBearerLinks();
    await setViewport(page, 'desktop');
    await mockPublicApi(page, {
      nullifiers: balanceAuthorised.nullifierFixtures,
    });
    await page.goto(`/balance/${balanceAuthorised.fragment}`);
    await expect(page.getByTestId('balance-attestation-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('check-subject_match')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('check-asset_match')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('check-network_id')).toHaveAttribute('data-status', 'pass');
    await snap(page, '05-balance-authorised');
  });
});
