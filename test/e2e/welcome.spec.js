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
  await expect(page.locator('#stepCount')).toHaveText('Step 1 of 6');
});
