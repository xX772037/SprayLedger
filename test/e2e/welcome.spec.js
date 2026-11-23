import { test, expect } from '@playwright/test';
import { blockOutsideServices } from './helpers.js';

test('a first visit opens the welcome page, and its buttons lead into the app', async ({ page }) => {
  await blockOutsideServices(page);
  await page.goto('/');
  await expect(page.locator('#viewHome')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your spray records, done before you leave the field.');
  await expect(page.locator('#mapcard')).toBeHidden(); // the map belongs to the job steps

  await page.getByRole('button', { name: 'Try the practice job' }).click();
  await expect(page.locator('#jobTitle')).toContainText('North 40');

  await page.getByRole('button', { name: 'SprayLedger home' }).click();
  await expect(page.locator('#viewHome')).toBeVisible();
  await page.getByRole('button', { name: 'Start a new job' }).first().click();
  await expect(page.locator('#stepCount')).toHaveText('Step 1 of 7');
});

test('the disclaimer and privacy pages open from the footer and the welcome page, and Back returns', async ({ page }) => {
  await blockOutsideServices(page);
  await page.goto('/');
  await page.locator('.home-cta').getByRole('button', { name: 'Read the disclaimer' }).click();
  await expect(page.locator('#viewAbout')).toBeVisible();
  await expect(page.locator('#disclaimer')).toContainText('The label is the law.');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('#viewHome')).toBeVisible();

  // From inside a job, the footer's Privacy link, then Back to the same step.
  await page.getByRole('button', { name: 'Try the practice job' }).click();
  await page.locator('.steps [data-step="products"]').click();
  await page.locator('.site-foot').getByRole('button', { name: 'Privacy' }).click();
  await expect(page.locator('#privacy')).toContainText('Your jobs stay on your device.');
  // the Privacy heading is below the sticky top bar, not hidden under it
  const [bar, head] = await Promise.all([page.locator('.appbar').boundingBox(), page.locator('#privTitle').boundingBox()]);
  expect(head.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  for (const s of ['Esri', 'OpenStreetMap', 'Open-Meteo', 'District III', 'GitHub Pages']) await expect(page.locator('#privacy')).toContainText(s);
  await expect(page.locator('#mapcard')).toBeHidden();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('#stepTitle')).toHaveText('What went in the tank');
});
