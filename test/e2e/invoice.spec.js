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
  expect(d.suggestedFilename()).toMatch(/invoice-\d+\.pdf$/); // named with the invoice number
});

const LOGO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGM4IScnl2cDAAc3Ac047clTAAAAAElFTkSuQmCC', 'base64');

test('invoice numbers count up, payment instructions carry to the next job, and the logo stays after a reload', async ({ page }) => {
  await blockOutsideServices(page);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');

  // First real job: invoice 1001.
  await page.getByRole('button', { name: 'Start a new job' }).first().click();
  await page.locator('.steps [data-step="finish"]').click();
  await page.locator('#f_field').fill('South 80');
  await page.locator('#f_company').fill('Test Spraying');
  await page.locator('.steps [data-step="invoice"]').click();
  await expect(page.locator('#f_invNo')).toHaveValue('1001');
  await page.locator('#f_payment').fill('Due within 30 days. Checks payable to Test Spraying.');
  await page.locator('#logoInput').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: LOGO_PNG });
  await expect(page.locator('#logoPreview img')).toBeVisible();
  await expect(page.locator('#logoRemove')).toBeVisible();
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('#invSave').click()]);
  expect(d.suggestedFilename()).toMatch(/South-80-invoice-1001\.pdf$/);

  // Second job: 1002, and the payment instructions came along with the business details.
  await page.locator('#btnNew').click();
  await page.locator('.steps [data-step="finish"]').click();
  await page.locator('#f_field').fill('West 40');
  await page.locator('.steps [data-step="invoice"]').click();
  await expect(page.locator('#f_invNo')).toHaveValue('1002');
  await expect(page.locator('#f_payment')).toHaveValue('Due within 30 days. Checks payable to Test Spraying.');

  // Typing a number another job already has gets a warning.
  await page.locator('#f_invNo').fill('1001');
  await expect(page.locator('#invNoWarn')).toHaveText('Invoice number 1001 is already used on another job.');
  await page.locator('#f_invNo').fill('1002');
  await expect(page.locator('#invNoWarn')).toBeHidden();

  // The logo is kept on the device.
  await page.reload();
  if (await page.locator('#viewJobs').isHidden()) await page.locator('#btnJobs').click(); // opens on My jobs when jobs exist
  await page.locator('#recList [data-id]', { hasText: 'South 80' }).click();
  await page.locator('.steps [data-step="invoice"]').click();
  await expect(page.locator('#f_invNo')).toHaveValue('1001');
  await expect(page.locator('#logoPreview img')).toBeVisible();
  expect(errors).toEqual([]);
});

test('invoice edge cases on screen: zero acres, zero rate, no cost, no products, rate with no products, negative acres', async ({ page }) => {
  await blockOutsideServices(page);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new job' }).first().click();
  const go = async step => page.locator(`.steps [data-step="${step}"]`).click();
  const setAcres = async v => {
    await go('finish');
    if (!(await page.locator('#f_acres').isVisible())) await page.getByText('Change acres or gallons').click();
    await page.locator('#f_acres').fill(v);
  };
  const total = async () => { await go('invoice'); return page.locator('#invTotal').innerText(); };
  const ok = t => { expect(t).toMatch(/^\$\d{1,3}(,\d{3})*\.\d{2}$/); expect(t).not.toContain('NaN'); expect(t).not.toContain('-'); };
  const results = {};

  // No products at all, nothing entered.
  await go('products'); // a new job has one blank product row, which is not a product
  results['no products, no rate'] = await total();
  // A rate but no products.
  await setAcres('40'); await go('invoice'); await page.locator('#f_invRate').fill('12');
  results['rate but no products'] = await total();
  // A product with no cost entered.
  await go('products'); await page.locator('#p0_pick').selectOption({ label: 'Roundup PowerMAX 3' }); await page.locator('#p0_rate').fill('32');
  results['product with no cost'] = await total();
  // Zero rate per acre, with a product cost.
  await page.locator('#f_invRate').fill('0'); await page.locator('[data-invcost]').first().fill('250');
  results['zero rate'] = await total();
  // Zero acres.
  await page.locator('#f_invRate').fill('12'); await setAcres('0');
  results['zero acres'] = await total();
  // Negative acres typed by mistake.
  await setAcres('-5');
  results['negative acres'] = await total();

  for (const t of Object.values(results)) ok(t);
  expect(results).toEqual({
    'no products, no rate': '$0.00', 'rate but no products': '$480.00', 'product with no cost': '$480.00',
    'zero rate': '$250.00', 'zero acres': '$250.00', 'negative acres': '$250.00',
  });
  expect(errors).toEqual([]);
});
