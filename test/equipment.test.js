import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRONES, droneById } from '../src/catalog.js';
import { applyCatalogEquipment, applyProfile, profileFromEquipment, isGround, sortProfiles } from '../src/equipment.js';
import { emptyRecord } from '../src/records.js';

test('picking a tractor sprayer fills ground values and marks it ground', () => {
  const eq = applyCatalogEquipment(emptyRecord().equipment, droneById('ground-sp'), DRONES);
  assert.equal(eq.kind, 'ground');
  assert.equal(eq.swathFt, 90); assert.equal(eq.tankGal, 1000); assert.equal(eq.speedMph, 12);
  assert.equal(eq.drone, '');
  assert.ok(isGround(eq));
});

test('picking a drone converts litres to gallons and keeps a typed make and model', () => {
  const eq = applyCatalogEquipment(emptyRecord().equipment, droneById('dji-t50'), DRONES);
  assert.equal(eq.drone, 'DJI Agras T50');
  assert.equal(eq.tankGal, 10.6); assert.equal(eq.flowGpm, 4.23);
  const typed = applyCatalogEquipment({ ...eq, drone: 'John Deere R4045' }, droneById('ground-sp'), DRONES);
  assert.equal(typed.drone, 'John Deere R4045');
  assert.ok(!isGround(eq));
});

test('a saved profile round-trips the boxes and keeps its id when updated', () => {
  let eq = applyCatalogEquipment(emptyRecord().equipment, droneById('ground-pull'), DRONES);
  eq = { ...eq, name: 'Big Red', drone: 'Hardi Navigator 1100', serial: 'HN-42', swathFt: 66, tankGal: 1100, flowGpm: 30, speedMph: 9, targetGpa: 15 };
  const p = profileFromEquipment(eq);
  assert.equal(p.kind, 'ground'); assert.equal(p.base, 'ground-pull'); assert.equal(p.name, 'Big Red');
  const job = applyProfile(emptyRecord().equipment, p);
  assert.equal(job.model, `p:${p.id}`);
  for (const k of ['drone', 'serial', 'swathFt', 'tankGal', 'flowGpm', 'speedMph', 'targetGpa']) assert.equal(job[k], eq[k], k);
  assert.ok(isGround(job));
  const again = profileFromEquipment({ ...job, swathFt: 80 }, { id: p.id });
  assert.equal(again.id, p.id); assert.equal(again.swathFt, 80); assert.equal(again.base, 'ground-pull');
});

test('a profile without a name gets a sensible one; drones list before ground rigs', () => {
  assert.equal(profileFromEquipment({ model: 'ground', kind: 'ground' }).name, 'My ground sprayer');
  assert.equal(profileFromEquipment({ model: 'dji-t25', drone: 'DJI Agras T25' }).name, 'DJI Agras T25');
  const s = sortProfiles([{ kind: 'ground', name: 'A' }, { kind: 'drone', name: 'Z' }, { kind: 'drone', name: 'B' }]);
  assert.deepEqual(s.map(x => x.name), ['B', 'Z', 'A']);
});

test('switching between a drone and a tractor resets the starting rate, but not between two of a kind', () => {
  const t = applyCatalogEquipment(emptyRecord().equipment, droneById('ground-sp'), DRONES);
  assert.equal(t.targetGpa, 15);
  const t2 = applyCatalogEquipment({ ...t, targetGpa: 12 }, droneById('ground-pull'), DRONES);
  assert.equal(t2.targetGpa, 12);
  const d = applyCatalogEquipment(t2, droneById('dji-t50'), DRONES);
  assert.equal(d.targetGpa, 2);
});
