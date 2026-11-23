import { test, expect } from '@playwright/test';
import { blockOutsideServices } from './helpers.js';

test('the practice job: enter a rate on the Invoice step and the total updates, then download the PDF', async ({ page }) => {
  await blockOutsideServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the practice job' }).click();
  await page.locator('.steps [data-step="invoice"]').click();
  await expect(page.locator('#stepTitle')).toHaveText('Invoice');
  await expect(page.locator('#stepCount')).toHaveText('Step 7 of 7');
  await expect(page.locator('#invTotal')).toHaveText('$0.00');

  // acres sprayed (as the app works them out from the practice log) × $10.00
  const acres = await page.evaluate(() => {
    const dd = [...document.querySelectorAll('#invHead div')].find(d => d.querySelector('dt').textContent === 'Acres sprayed');
    return parseFloat(dd.querySelector('dd').textContent);
  });
  expect(acres).toBeGreaterThan(30);
  const dollars = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await page.locator('#f_invRate').fill('10');
  const shownApp = await page.locator('#invApp').innerText();
  const app = parseFloat(shownApp.replace(/[$,]/g, ''));
  expect(Math.abs(app - acres * 10)).toBeLessThan(0.06); // acres shown to 2 decimals
  await expect(page.locator('#invTotal')).toHaveText(shownApp);

  // add a charge for the first product: the total is application + products
  await page.locator('[data-invcost]').first().fill('100.5');
  await expect(page.locator('#invProd')).toHaveText('$100.50');
  await expect(page.locator('#invTotal')).toHaveText(dollars(Math.round((app + 100.5) * 100) / 100));

  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('#invSave').click()]);
  expect(d.suggestedFilename()).toMatch(/invoice\.pdf$/);
});
