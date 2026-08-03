/**
 * Spec 10 — Shell landmarks + nav groups + active-link styling.
 *
 * Basic a11y without @axe-core/playwright: assert header / nav[aria-label] /
 * main / footer landmarks already present in the markup.
 */

import { expect, test } from '@playwright/test';
import { mockPublicApi } from './_helpers/network';
import { snap, setViewport } from './_helpers/screenshot';

const ROUTES: Array<{ href: string; rootTestId: string | null; label: string }> = [
  { href: '/', rootTestId: 'inscription-list', label: 'Inscriptions' },
  { href: '/accumulator/', rootTestId: 'accumulator-view', label: 'Accumulator' },
  { href: '/nullifier/', rootTestId: 'nullifier-lookup', label: 'Nullifier lookup' },
  { href: '/tx/', rootTestId: 'fragment-empty', label: 'Tx link' },
  { href: '/balance/', rootTestId: 'fragment-empty', label: 'Balance link' },
  { href: '/addr/', rootTestId: 'fragment-empty', label: 'Addr link' },
];

test.describe('10 nav shell a11y — functional', () => {
  test('landmarks and both nav groups', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/');

    await expect(page.locator('header')).toContainText('Explorer');
    const nav = page.locator('nav[aria-label="Explorer modes"]');
    await expect(nav).toBeVisible();
    await expect(nav).toContainText('Public');
    await expect(nav).toContainText('Authorised');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();

    for (const route of ROUTES) {
      await page
        .locator('nav[aria-label="Explorer modes"]')
        .getByRole('link', { name: route.label })
        .click();
      if (route.rootTestId !== null) {
        await expect(page.getByTestId(route.rootTestId)).toBeVisible({ timeout: 15_000 });
      }
      // Nav.tsx applies `bg-line2` when the link is active.
      const active = page
        .locator('nav[aria-label="Explorer modes"]')
        .getByRole('link', { name: route.label });
      await expect(active).toHaveClass(/bg-line2/);
    }
  });
});

test.describe('Visual Regression — 10 nav shell', () => {
  test('10-nav-shell-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/');
    await expect(page.getByTestId('inscription-list')).toBeVisible();
    await expect(page.locator('header')).toContainText('Explorer');
    await expect(page.locator('nav[aria-label="Explorer modes"]')).toBeVisible();
    await snap(page, '10-nav-shell-desktop');
  });

  test('10-nav-shell-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await mockPublicApi(page);
    await page.goto('/');
    await expect(page.getByTestId('inscription-list')).toBeVisible();
    await snap(page, '10-nav-shell-mobile');
  });
});
