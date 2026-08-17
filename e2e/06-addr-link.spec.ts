/**
 * Spec 06 — Address view link (`/addr/`).
 *
 * Without holder-hint / relay URLs the explorer never mesh-scans and lands
 * on the honest history-not-resolvable state (spec-accurate, not a gap).
 */

import { expect, test } from '@playwright/test';
import { mockPublicApi } from './_helpers/network';
import { snap, setViewport } from './_helpers/screenshot';
import { readBearerLinks } from './_helpers/fixtures';

test.describe('06 addr link — functional', () => {
  test('empty fragment shows grammar hint', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/addr/');
    const empty = page.getByTestId('fragment-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('/addr#<zk-address>/<zkavk>');
  });

  test('incoming-only mode shows history-not-resolvable', async ({ page }) => {
    const { addrIncomingOnly } = readBearerLinks();
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto(`/addr/${addrIncomingOnly.fragment}`);
    await expect(page.getByTestId('address-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('avk-mode')).toContainText('incoming-only');
    await expect(page.getByTestId('history-not-resolvable')).toBeVisible();
  });

  test('full mode label', async ({ page }) => {
    const { addrFull } = readBearerLinks();
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto(`/addr/${addrFull.fragment}`);
    await expect(page.getByTestId('address-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('avk-mode')).toContainText('full');
  });
});

test.describe('Visual Regression — 06 addr link', () => {
  test('06-addr-empty', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/addr/');
    await expect(page.getByTestId('fragment-empty')).toBeVisible();
    await snap(page, '06-addr-empty');
  });

  test('06-addr-incoming-only', async ({ page }) => {
    const { addrIncomingOnly } = readBearerLinks();
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto(`/addr/${addrIncomingOnly.fragment}`);
    await expect(page.getByTestId('address-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('avk-mode')).toContainText('incoming-only');
    await expect(page.getByTestId('history-not-resolvable')).toBeVisible();
    await snap(page, '06-addr-incoming-only');
  });

  test('06-addr-full-mode', async ({ page }) => {
    const { addrFull } = readBearerLinks();
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto(`/addr/${addrFull.fragment}`);
    await expect(page.getByTestId('address-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('avk-mode')).toContainText('full');
    await snap(page, '06-addr-full-mode');
  });
});
