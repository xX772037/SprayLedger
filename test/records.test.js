import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRecord, productTotals, reentryTime, harvestDate, complianceCheck, recordsToCSV } from '../src/records.js';
import { parseCSV } from '../src/parse.js';

function rec() {
  const r = emptyRecord();
  r.summary = { acresTreated: 40, volumeGal: 84, lat: 41.9, lon: -93.5, fieldAcres: 40.5 };
  r.equipment.targetGpa = 2;
  r.job = { ...r.job, date: '2026-06-14', start: '06:42', end: '08:33', field: 'North 40', crop: 'Soybeans' };
  r.products = [{ name: 'Fungicide "X"', epa: '100-1234', rate: '8', unit: 'fl oz', rei: '12', phi: '21' }];
  return r;
}

test('product applied uses measured spray volume and tank-mix concentration', () => {
  const t = productTotals(rec().products[0], rec());
  // 8 fl oz per 2 gal of mix × 84 gal sprayed = 336 fl oz
  assert.equal(t.total, 336);
  assert.equal(t.actualRate, 8.4);
  assert.equal(t.method, 'measured');
});

test('falls back to label rate × acres when no volume was measured', () => {
  const r = rec(); r.summary.volumeGal = null;
  const t = productTotals(r.products[0], r);
  assert.equal(t.total, 320);
  assert.equal(t.method, 'label');
});

test('manual overrides win over log values', () => {
  const r = rec(); r.job.acresOverride = '38'; r.volumeGalOverride = '76';
  const t = productTotals(r.products[0], r);
  assert.equal(t.total, 304);
  assert.equal(t.actualRate, 8);
});

test('re-entry and harvest intervals use the longest REI and PHI in the mix', () => {
  const r = rec();
  r.products.push({ name: 'B', epa: '1-1', rate: '1', unit: 'pt', rei: '48', phi: '7' });
  const re = reentryTime(r);
  assert.equal(re.getDate(), 16); assert.equal(re.getHours(), 8); assert.equal(re.getMinutes(), 33);
  const hv = harvestDate(r);
  assert.equal(hv.getMonth(), 6); assert.equal(hv.getDate(), 5); // June 14 + 21 days = July 5
});

test('compliance check lists missing federal and state items', () => {
  const r = rec();
  let c = complianceCheck(r);
  const missing = c.missing.map(m => m.label);
  assert.ok(missing.includes('Applicator name'));
  assert.ok(missing.includes('Wind speed and direction'));
  r.applicator = { name: 'A', cert: 'C-1', company: '' };
  r.conditions = { wind: '5', windDir: 'SW', temp: '70', humidity: '' };
  c = complianceCheck(r);
  assert.equal(c.complete, true);
});

test('CSV export escapes quotes and writes one row per product', () => {
  const r = rec();
  r.products.push({ name: 'Adjuvant', epa: '', rate: '0.25', unit: 'pt', rei: '', phi: '' });
  const rows = parseCSV(recordsToCSV([r]));
  assert.equal(rows.length, 3);
  const h = rows[0];
  assert.equal(rows[1][h.indexOf('Product')], 'Fungicide "X"');
  assert.equal(rows[1][h.indexOf('Total product applied')], '336.00 fl oz');
  assert.equal(rows[2][h.indexOf('Total product applied')], '10.50 pt');
  assert.equal(rows[1][h.indexOf('Re-entry allowed')], '2026-06-14 20:33');
});
