import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { blockOutsideServices, tileValue } from './helpers.js';

const LOG = fileURLToPath(new URL('./fixtures/spray-rate-log.csv', import.meta.url));

test('a flight log whose flow column is named spray_rate gives coverage and gallons', async ({ page }) => {
  await blockOutsideServices(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');

  // Start a blank job so only this log counts.
  await page.getByRole('button', { name: 'New job', exact: true }).click();
  await expect(page.locator('#jobTitle')).toHaveText('New job');
  await page.locator('.steps').getByRole('tab', { name: /Spray/ }).click();

  const chooser = page.waitForEvent('filechooser');
  await page.locator('label.file-btn').click();
  await (await chooser).setFiles(LOG);
  await expect(page.locator('#files')).toContainText('spray-rate-log.csv');

  // The spray_rate column must count as flow (and as spraying), not be mistaken for an on/off switch.
  await expect(page.locator('#stats .stat')).toHaveCount(4);
  expect(await tileValue(page, 'Acres sprayed')).toBeGreaterThan(0);
  expect(await tileValue(page, 'Gallons')).toBeGreaterThan(0);
  await expect(page.locator('#notices')).not.toContainText('No spraying found');
  expect(errors).toEqual([]);
});
