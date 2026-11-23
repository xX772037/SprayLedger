import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRecord, productTotals, reentryTime, harvestDate, complianceCheck, recordsToCSV, toGalOrLb, normalizeRecord } from '../src/records.js';
import { parseCSV } from '../src/parse.js';

function rec() {
  const r = emptyRecord();
  r.summary = { acresTreated: 40, volumeGal: 84, lat: 41.9, lon: -93.5, fieldAcres: 40.5 };
  r.equipment.targetGpa = 2;
  r.job = { ...r.job, date: '2026-06-14', start: '06:42', end: '08:33', field: 'North 40', crop: 'Soybeans' };
  r.products = [{ ...r.products[0], name: 'Fungicide "X"', epa: '100-1234', rate: '8', unit: 'fl oz', rei: '12', phi: '21' }];
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

test('South Dakota record check follows ARSD 12:56:07:01 items 1–11', () => {
  const r = rec();
  let c = complianceCheck(r);
  const miss = c.missing.map(m => m.ref);
  assert.deepEqual(miss, ['1', '3', '6', '7', '8', '9', '10', 'form', 'addr']);
  r.job.farm = 'Example Farms'; r.job.customerAddress = '1 Main St, Olivet SD'; r.job.pest = 'Aphids';
  r.applicator = { ...r.applicator, name: 'A', cert: 'AP-1', address: 'Menno SD' };
  r.conditions = { wind: '5', windDir: 'SW', temp: '70', humidity: '', source: 'On site' };
  r.products[0] = { ...r.products[0], common: 'pyraclostrobin', company: 'Example Co', ai: '2.09 lb/gal' };
  c = complianceCheck(r);
  assert.equal(c.complete, true, JSON.stringify(c.missing));
  r.products[0].rup = true; r.products[0].epa = '';
  assert.deepEqual(complianceCheck(r).missing.map(m => m.ref), ['RUP']);
});

test('totals convert to gallons or pounds for the state form', () => {
  assert.deepEqual(toGalOrLb(256, 'fl oz'), { value: 2, unit: 'gal' });
  assert.deepEqual(toGalOrLb(32, 'oz'), { value: 2, unit: 'lb' });
  const t = productTotals(rec().products[0], rec());
  assert.deepEqual(t.galOrLb, { value: 2.625, unit: 'gal' }); // 336 fl oz
});

test('older saved records gain the new fields', () => {
  const old = { id: 'x', job: { date: '2026-06-14' }, products: [{ name: 'P', rate: '1', unit: 'pt' }], applicator: { name: 'A' } };
  const n = normalizeRecord(old);
  assert.equal(n.job.customerAddress, ''); assert.equal(n.products[0].common, ''); assert.equal(n.products[0].unit, 'pt');
  assert.equal(n.conditions.source, ''); assert.equal(n.applicator.name, 'A');
});

test('CSV export escapes quotes and writes one row per product', () => {
  const r = rec();
  r.products.push({ name: 'Adjuvant', epa: '', rate: '0.25', unit: 'pt', rei: '', phi: '' });
  const rows = parseCSV(recordsToCSV([r]));
  assert.equal(rows.length, 3);
  const h = rows[0];
  assert.equal(rows[1][h.indexOf('Product (trade name)')], 'Fungicide "X"');
  assert.equal(rows[1][h.indexOf('Total (gal or lb)')], '2.625 gal');
  assert.equal(rows[1][h.indexOf('Total product applied')], '336.00 fl oz');
  assert.equal(rows[2][h.indexOf('Total product applied')], '10.50 pt');
  assert.equal(rows[1][h.indexOf('Re-entry allowed')], '2026-06-14 20:33');
});

test('one product with unknown REI gives no re-entry time and an incomplete record', async () => {
  const { emptyRecord, reentryTime, complianceCheck, missingRei } = await import('../src/records.js');
  const r = emptyRecord();
  r.job = { ...r.job, date: '2026-06-14', start: '06:42', end: '08:33' };
  r.products = [{ ...r.products[0], name: 'Known', rate: '1', rei: '48' }, { ...r.products[0], name: 'Unknown', rate: '1', rei: '' }];
  assert.equal(reentryTime(r), null);           // not 48 h from the known product alone
  assert.deepEqual(missingRei(r).map(p => p.name), ['Unknown']);
  const c = complianceCheck(r);
  assert.equal(c.complete, false);
  assert.ok(c.missing.some(m => m.ref === 'REI'));
});

test('the record check: 11 rule items plus license, address and REI; adjuvants skip the pesticide items', async () => {
  const { emptyRecord, complianceCheck } = await import('../src/records.js');
  const r = emptyRecord();
  r.job = { ...r.job, date: '2026-06-14', start: '06:42', end: '08:33', farm: 'F', customerAddress: 'A', pest: 'P', crop: 'C', legal: 'NE1/4 6-98-58', acresOverride: '40' };
  r.applicator = { name: 'Pat', cert: 'AP-1', company: 'Co', phone: '', address: 'Menno SD' };
  r.conditions = { wind: '6', windDir: 'SW', temp: '68' };
  r.volumeGalOverride = '80';
  r.equipment = { ...r.equipment, targetGpa: 2 };
  r.products = [
    { ...r.products[0], name: 'Veltyma', common: 'x', company: 'BASF', ai: '1.67 lb per gal', rate: '7', unit: 'fl oz', rei: '12' },
    { ...r.products[0], name: 'Non-ionic surfactant (NIS)', common: 'non-ionic surfactant', kind: 'adjuvant', company: '', ai: '', rate: '0.25', unit: '% v/v', rei: '' },
  ];
  const c = complianceCheck(r);
  assert.deepEqual(c.items.map(i => i.ref), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'form', 'addr', 'REI']);
  assert.equal(c.complete, true, c.missing.map(m => m.label).join(', '));
  r.applicator.address = '';
  assert.deepEqual(complianceCheck(r).missing.map(m => m.ref), ['addr']);
});

// ---- invoice ----
async function invoiceJob() {
  const { emptyRecord } = await import('../src/records.js');
  const r = emptyRecord();
  r.job = { ...r.job, date: '2026-06-14', farm: 'Example Farms', field: 'North 40', acresOverride: '39.42' };
  r.products = [
    { ...r.products[0], name: 'Veltyma', rate: '7', unit: 'fl oz', invoiceCost: '250' },
    { ...r.products[0], name: 'Non-ionic surfactant (NIS)', rate: '0.25', unit: 'pt', invoiceCost: '18.5' },
  ];
  return r;
}

test('invoice: acres × rate per acre', async () => {
  const { invoiceTotals } = await import('../src/records.js');
  const r = await invoiceJob(); r.invoice.ratePerAcre = '12';
  const inv = invoiceTotals(r);
  assert.equal(inv.rate, 12);
  assert.equal(inv.application, 473.04); // 39.42 × 12
});

test('invoice: product costs add up, and the total is application + products', async () => {
  const { invoiceTotals } = await import('../src/records.js');
  const r = await invoiceJob(); r.invoice.ratePerAcre = '12';
  const inv = invoiceTotals(r);
  assert.deepEqual(inv.lines.map(l => l.cost), [250, 18.5]);
  assert.equal(inv.productCost, 268.5);
  assert.equal(inv.total, 741.54);
});

test('invoice: zero, blank, negative or junk rate and costs count as $0', async () => {
  const { invoiceTotals } = await import('../src/records.js');
  const r = await invoiceJob();
  r.invoice.ratePerAcre = '';
  r.products[0].invoiceCost = ''; r.products[1].invoiceCost = '';
  let inv = invoiceTotals(r);
  assert.deepEqual([inv.rate, inv.application, inv.productCost, inv.total], [0, 0, 0, 0]);
  r.invoice.ratePerAcre = '0'; r.products[0].invoiceCost = '-5'; r.products[1].invoiceCost = 'abc';
  inv = invoiceTotals(r);
  assert.deepEqual([inv.rate, inv.application, inv.productCost, inv.total], [0, 0, 0, 0]);
  r.invoice.ratePerAcre = '0'; r.products[0].invoiceCost = '100';
  assert.equal(invoiceTotals(r).total, 100, 'zero rate: products only');
});

test('invoice: unknown acres charge nothing for application and say so; rounding is to the cent', async () => {
  const { invoiceTotals } = await import('../src/records.js');
  const r = await invoiceJob(); r.job.acresOverride = ''; r.invoice.ratePerAcre = '12';
  let inv = invoiceTotals(r);
  assert.equal(inv.acresKnown, false); assert.equal(inv.application, 0); assert.equal(inv.total, 268.5);
  r.job.acresOverride = '10.333'; r.invoice.ratePerAcre = '3.333'; r.products.forEach(p => { p.invoiceCost = ''; });
  inv = invoiceTotals(r);
  assert.equal(inv.acres, 10.33, 'billed on the acres as printed');
  assert.equal(inv.application, 34.43); // 10.33 × 3.333 = 34.42989
});

test('invoice: older saved jobs without an invoice open with $0, and the spreadsheet has the two invoice columns', async () => {
  const { normalizeRecord, recordsToCSV } = await import('../src/records.js');
  const r = await invoiceJob(); delete r.invoice;
  const n = normalizeRecord(structuredClone(r));
  assert.deepEqual(n.invoice, { number: '', ratePerAcre: '', total: 0 });
  r.invoice = { number: '1001', ratePerAcre: '12', total: 741.54 };
  const lines = recordsToCSV([r]).trim().split('\r\n');
  const head = lines[0].split(','), row = lines[1].split(',');
  assert.deepEqual(head.slice(-3), ['invoice_rate_per_acre', 'invoice_total', 'invoice_number']);
  assert.deepEqual(row.slice(-3), ['12.00', '741.54', '1001']);
});

test('invoice: the printed acres × rate always equals the printed application charge', async () => {
  const { invoiceTotals } = await import('../src/records.js');
  const r = await invoiceJob(); r.job.acresOverride = '39.418'; r.invoice.ratePerAcre = '12';
  const inv = invoiceTotals(r);
  assert.equal(inv.acres, 39.42);
  assert.equal(inv.application, 473.04);
});

test('invoice numbers: 1001 first, then count up from the newest, keeping any prefix and zeros, never reusing one', async () => {
  const { nextInvoiceNumber, invoiceNumberTaken } = await import('../src/records.js');
  const job = (number, updatedAt) => ({ id: `j${number}`, updatedAt, invoice: { number } });
  assert.equal(nextInvoiceNumber([]), '1001');
  assert.equal(nextInvoiceNumber([job('', 1)]), '1001');
  assert.equal(nextInvoiceNumber([job('1001', 1), job('1002', 2)]), '1003');
  assert.equal(nextInvoiceNumber([job('2026-014', 5), job('1007', 1)]), '2026-015', 'follows the newest');
  assert.equal(nextInvoiceNumber([job('INV-0099', 1)]), 'INV-0100');
  assert.equal(nextInvoiceNumber([job('1005', 2), job('1006', 1)]), '1007', 'skips a number already used');
  assert.equal(nextInvoiceNumber([job('Smith', 1)]), 'Smith-1', 'no digits: a suffix is added');
  const a = { id: 'a', invoice: { number: '1001' } }, b = { id: 'b', invoice: { number: '1001' } };
  assert.equal(invoiceNumberTaken([a, b], a), true);
  assert.equal(invoiceNumberTaken([a], a), false, 'its own number is not a clash');
  assert.equal(invoiceNumberTaken([a, b], { id: 'c', invoice: { number: '' } }), false);
});

test('payment instructions are part of the business details carried to new jobs', async () => {
  const { emptyRecord, normalizeRecord } = await import('../src/records.js');
  assert.equal(emptyRecord().applicator.payment, '');
  const old = emptyRecord(); delete old.applicator.payment;
  assert.equal(normalizeRecord(old).applicator.payment, '');
});

// ---- invoice edge cases from the pre-merge check: the total is never NaN, negative, -0 or blank ----
test('invoice edge cases: every total is a real, non-negative dollar amount', async () => {
  const { emptyRecord, invoiceTotals, fmtMoney } = await import('../src/records.js');
  const job = ({ acres = '40', rate = '12', products } = {}) => { const r = emptyRecord(); r.job.acresOverride = acres; r.invoice.ratePerAcre = rate; if (products) r.products = products; return r; };
  const P = cost => ({ ...emptyRecord().products[0], name: 'Veltyma', rate: '7', unit: 'fl oz', invoiceCost: cost });
  const cases = [
    ['zero acres', job({ acres: '0', products: [P('250')] }), '$250.00'],
    ['zero rate per acre', job({ rate: '0', products: [P('250')] }), '$250.00'],
    ['a product with no cost entered', job({ products: [P('')] }), '$480.00'],
    ['no products at all (and no rate)', job({ rate: '', products: [] }), '$0.00'],
    ['a rate but no products', job({ products: [] }), '$480.00'],
    ['acres not known', job({ acres: '', products: [P('250')] }), '$250.00'],
    ['negative acres typed', job({ acres: '-5', products: [] }), '$0.00'],
    ['a tiny negative that rounds to -0', job({ acres: '-0.001', products: [] }), '$0.00'],
    ['junk rate and a negative cost', job({ rate: 'abc', products: [P('-20')] }), '$0.00'],
  ];
  for (const [name, r, want] of cases) {
    const inv = invoiceTotals(r);
    for (const k of ['application', 'productCost', 'total']) {
      assert.ok(Number.isFinite(inv[k]) && inv[k] >= 0 && !Object.is(inv[k], -0), `${name}: ${k} = ${inv[k]}`);
      assert.match(fmtMoney(inv[k]), /^\$\d{1,3}(,\d{3})*\.\d{2}$/, `${name}: ${k} shows ${fmtMoney(inv[k])}`);
    }
    assert.equal(fmtMoney(inv.total), want, name);
  }
  assert.equal(fmtMoney(-0), '$0.00'); assert.equal(fmtMoney(NaN), '$0.00'); assert.equal(fmtMoney(-3), '$0.00');
});
