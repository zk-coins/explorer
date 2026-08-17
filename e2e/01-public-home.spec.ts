/**
 * Spec 01 — Public home (`/`) — InscriptionList + aggregate counts.
 */

import { expect, test } from '@playwright/test';
import { mockPublicApi } from './_helpers/network';
import { snap, setViewport } from './_helpers/screenshot';
import {
  FIXTURE_ACCUMULATOR_RAW,
  FIXTURE_INSCRIPTIONS_PAGE1_RAW,
  FIXTURE_INSCRIPTIONS_PAGE2_RAW,
} from './_fixtures/publicChain';

test.describe('01 public home — functional', () => {
  test('lists first page with load-more affordance', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/');

    await expect(page.getByTestId('inscription-list')).toBeVisible();
    await expect(page.getByTestId('aggregate-counts')).toBeVisible();
    await expect(page.getByTestId('aggregate-counts')).toContainText(
      String(FIXTURE_INSCRIPTIONS_PAGE1_RAW.inscriptions.length),
    );
    await expect(page.getByTestId('aggregate-counts')).toContainText(FIXTURE_ACCUMULATOR_RAW.size);
    await expect(page.getByTestId('inscription-card')).toHaveCount(2);
    await expect(page.getByTestId('load-more-inscriptions')).toBeVisible();

    await page.getByTestId('load-more-inscriptions').click();
    const total =
      FIXTURE_INSCRIPTIONS_PAGE1_RAW.inscriptions.length +
      FIXTURE_INSCRIPTIONS_PAGE2_RAW.inscriptions.length;
    await expect(page.getByTestId('inscription-card')).toHaveCount(total);
    await expect(page.getByTestId('load-more-inscriptions')).toHaveCount(0);
  });

  test('empty inscriptions page', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page, { inscriptions: 'empty' });
    await page.goto('/');
    await expect(page.getByTestId('inscriptions-empty')).toBeVisible();
  });
});

test.describe('Visual Regression — 01 public home', () => {
  test('01-home-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/');
    await expect(page.getByTestId('inscription-list')).toBeVisible();
    await expect(page.getByTestId('inscription-card')).toHaveCount(2);
    await expect(page.getByTestId('load-more-inscriptions')).toBeVisible();
    await snap(page, '01-home-desktop');
  });

  test('01-home-loaded-more', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/');
    await page.getByTestId('load-more-inscriptions').click();
    const total =
      FIXTURE_INSCRIPTIONS_PAGE1_RAW.inscriptions.length +
      FIXTURE_INSCRIPTIONS_PAGE2_RAW.inscriptions.length;
    await expect(page.getByTestId('inscription-card')).toHaveCount(total);
    await expect(page.getByTestId('load-more-inscriptions')).toHaveCount(0);
    await snap(page, '01-home-loaded-more');
  });

  test('01-home-empty', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page, { inscriptions: 'empty' });
    await page.goto('/');
    await expect(page.getByTestId('inscriptions-empty')).toBeVisible();
    await snap(page, '01-home-empty');
  });

  test('01-home-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await mockPublicApi(page);
    await page.goto('/');
    await expect(page.getByTestId('inscription-list')).toBeVisible();
    await snap(page, '01-home-mobile');
  });
});
