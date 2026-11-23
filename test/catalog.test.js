import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRONES, PRODUCTS, droneById, planJob, applyCatalogProduct, productsFromJobs, lpmToGpm, litersToGal } from '../src/catalog.js';

test('catalog entries are complete and EPA numbers are well formed', () => {
  assert.equal(new Set(DRONES.map(d => d.id)).size, DRONES.length);
  for (const d of DRONES) assert.ok(d.model && d.swathFt > 0 && d.spec, d.id);
  for (const p of PRODUCTS) {
    assert.ok(p.name && p.common && p.group, p.name);
    if (p.epa) assert.match(p.epa, /^\d{1,6}-\d{1,5}$/, p.name);
  }
  assert.equal(PRODUCTS.find(p => p.name === 'Headline AMP').epa, '7969-291'); // not Headline SC's 7969-289
});

test('job plan: gallons, tank loads and time', () => {
  const t50 = droneById('dji-t50');
  const p = planJob({ acres: 80, gpa: 2, swathFt: t50.swathFt, tankGal: litersToGal(t50.tankL), flowGpm: lpmToGpm(t50.flowLpm) });
  assert.equal(p.gallons, 160);
  assert.equal(p.loads, 16);                  // 40 L ≈ 10.57 gal per load
  assert.equal(p.mph, 15); assert.equal(p.flowLimited, false);
  assert.ok(p.acPerHour > 40 && p.acPerHour < 46, `ac/h ${p.acPerHour}`);
  assert.ok(Math.abs(p.totalHours - (80 / p.acPerHour + 16 * 4 / 60)) < 1e-9);
});

test('a small pump at a high rate limits ground speed', () => {
  // 1 gpm at 5 gal/ac over a 30 ft swath: 0.2 ac/min ≈ 809 m²/min ÷ 9.144 m ≈ 88.5 m/min ≈ 3.3 mph
  const p = planJob({ acres: 10, gpa: 5, swathFt: 30, tankGal: 10, flowGpm: 1 });
  assert.equal(p.flowLimited, true);
  assert.ok(Math.abs(p.mph - 3.30) < 0.02, `mph ${p.mph}`);
  assert.equal(planJob({ acres: 0, gpa: 2 }), null);
});

test('picking a product fills label facts only, never rate or PHI', () => {
  const typed = { name: 'x', common: '', company: 'My co', epa: '', ai: '', rate: '8', unit: 'fl oz', rei: '', phi: '21', rup: false };
  const veltyma = PRODUCTS.find(p => p.name === 'Veltyma');
  const a = applyCatalogProduct(typed, veltyma);
  assert.deepEqual([a.name, a.epa, a.company, a.ai, a.rei, a.rate, a.phi], ['Veltyma', '7969-409', 'BASF', '1.67 + 1.67 lb per gal', '12', '8', '21']);
  // switching to a product with fewer known facts clears the previous product's facts
  const b = applyCatalogProduct(a, PRODUCTS.find(p => p.name === 'Trivapro'));
  assert.equal(b.ai, ''); assert.equal(b.rei, ''); assert.equal(b.epa, '100-1613');
  assert.equal(applyCatalogProduct(typed, PRODUCTS.find(p => p.name === 'Tordon 22K')).rup, true);
});

test('products from saved jobs are offered newest first, once each', () => {
  const recs = [{ products: [{ name: 'Veltyma', rate: '10' }, { name: '' }] }, { products: [{ name: 'veltyma ', rate: '7' }, { name: 'Callisto', rate: '3' }] }];
  assert.deepEqual(productsFromJobs(recs).map(p => `${p.name}:${p.rate}`), ['Veltyma:10', 'Callisto:3']);
});
