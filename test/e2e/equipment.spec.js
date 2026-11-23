import { test, expect } from '@playwright/test';
import { blockOutsideServices } from './helpers.js';

async function newJobOnPlan(page) {
  await page.locator('#btnNew').click();
  await expect(page.locator('#viewJob')).toBeVisible();
  await page.locator('.steps').getByRole('tab', { name: /Plan/ }).click();
  await expect(page.locator('[data-panel="weather"]')).toBeVisible();
}

test('a drone and a tractor sprayer are saved once and fill the boxes on later jobs', async ({ page }) => {
  await blockOutsideServices(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');

  // Tractor sprayers are in the list, and picking one switches the label to boom width.
  await newJobOnPlan(page);
  const model = page.locator('#f_model');
  await expect(model.locator('optgroup[label="Tractor and ground sprayers"] option')).toHaveCount(4);
  await model.selectOption('ground-sp');
  await expect(page.locator('#lblSwath')).toHaveText('Boom width, feet');
  await expect(page.locator('#f_swathPlan')).toHaveValue('90');

  // The applicator puts in their own rig and saves it.
  await page.locator('#f_eqName').fill('Big Deere');
  await page.locator('#f_eqMake').fill('John Deere R4045');
  await page.locator('#f_eqSerial').fill('1N04045XXK0001');
  await page.locator('#f_swathPlan').fill('120');
  await page.locator('#f_tank').fill('1200');
  await page.locator('#f_flow').fill('60');
  await page.locator('#f_speed').fill('14');
  await page.locator('#f_gpa').fill('15');
  await page.locator('#eqSave').click();
  await expect(page.locator('#eqState')).toContainText('Saved "Big Deere"');
  await expect(page.locator('#eqSave')).toHaveText('Save changes to "Big Deere"');
  await expect(page.locator('#eqDelete')).toBeVisible();

  // And a drone.
  await model.selectOption('dji-t50');
  await expect(page.locator('#lblSwath')).toHaveText('Swath, feet');
  await page.locator('#f_eqName').fill('T50 number 2');
  await page.locator('#f_eqSerial').fill('FA3XXXXXX');
  await page.locator('#f_swathPlan').fill('28');
  await page.locator('#eqSave').click();
  await expect(page.locator('#eqState')).toContainText('Saved "T50 number 2"');

  // Reload: both are still there, and picking one fills every box.
  await page.reload();
  await newJobOnPlan(page);
  const mine = model.locator('optgroup[label="My equipment"] option');
  await expect(mine).toHaveCount(2);
  await expect(mine.nth(0)).toContainText('T50 number 2');   // drones first
  await expect(mine.nth(1)).toContainText('Big Deere');
  await model.selectOption({ label: 'Big Deere (John Deere R4045)' });
  await expect(page.locator('#lblSwath')).toHaveText('Boom width, feet');
  await expect(page.locator('#f_eqMake')).toHaveValue('John Deere R4045');
  await expect(page.locator('#f_eqSerial')).toHaveValue('1N04045XXK0001');
  await expect(page.locator('#f_swathPlan')).toHaveValue('120');
  await expect(page.locator('#f_tank')).toHaveValue('1200');
  await expect(page.locator('#f_flow')).toHaveValue('60');
  await expect(page.locator('#f_speed')).toHaveValue('14');
  await expect(page.locator('#f_gpa')).toHaveValue('15');

  // Changing a box says it isn't saved yet; Save changes updates the same profile (no duplicate).
  await page.locator('#f_tank').fill('1000');
  await expect(page.locator('#eqState')).toContainText('Tap Save changes');
  await page.locator('#eqSave').click();
  await expect(page.locator('#eqState')).toContainText('Saved the changes to "Big Deere"');
  await expect(mine).toHaveCount(2);

  // Delete asks for a second tap, then removes only the saved profile.
  await page.locator('#eqDelete').click();
  await page.locator('#eqDelete').click();
  await expect(page.locator('#eqState')).toContainText('Deleted "Big Deere"');
  await expect(mine).toHaveCount(1);
  await expect(page.locator('#f_tank')).toHaveValue('1000');
  expect(errors).toEqual([]);
});
