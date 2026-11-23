import { test, expect } from '@playwright/test';
import { blockOutsideServices } from './helpers.js';

test.use({ timezoneId: 'America/Chicago' });

// 11:00 with no time zone: read as UTC by default (6:00 AM in South Dakota in June), switchable to local.
const LOG = 'time,lat,lon,flow_l_min\n' + Array.from({ length: 30 }, (_, i) =>
  `2026-06-14 11:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')},${(43.3 + i * 0.00004).toFixed(6)},-97.900000,4.5`).join('\n') + '\n';

test('log times without a time zone are read as UTC, and can be switched to local time', async ({ page }) => {
  await blockOutsideServices(page);
  await page.goto('/');
  await page.locator('#btnNew').click();
  await page.locator('.steps [data-step="spray"]').click();
  await page.locator('#fileInput').setInputFiles({ name: 'naive.csv', mimeType: 'text/csv', buffer: Buffer.from(LOG) });
  await expect(page.locator('#tzRow')).toBeVisible();
  await expect(page.locator('#logTz')).toHaveValue('utc');
  await expect(page.locator('#notices')).toContainText('read as UTC');

  await page.locator('.steps [data-step="finish"]').click();
  await expect(page.locator('#f_start')).toHaveValue('06:00');

  await page.locator('.steps [data-step="spray"]').click();
  await page.locator('#logTz').selectOption('local');
  await page.locator('.steps [data-step="finish"]').click();
  await expect(page.locator('#f_start')).toHaveValue('11:00');
});

test('a KML track with no times imports without invented times', async ({ page }) => {
  await blockOutsideServices(page);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.locator('#btnNew').click();
  await page.locator('.steps [data-step="spray"]').click();
  const coords = Array.from({ length: 40 }, (_, i) => `-97.9,${(43.3 + i * 0.00004).toFixed(6)}`).join(' ');
  await page.locator('#fileInput').setInputFiles({ name: 'track.kml', mimeType: 'application/vnd.google-earth.kml+xml',
    buffer: Buffer.from(`<kml><Placemark><LineString><coordinates>${coords}</coordinates></LineString></Placemark></kml>`) });
  await expect(page.locator('#stats')).toContainText('no times in the file');
  await expect(page.locator('#flights')).toContainText('No times in file');
  expect(errors).toEqual([]);
});
