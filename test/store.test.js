// Saved jobs and equipment. Node has no IndexedDB, so this runs the in-memory fallback the app uses in
// private windows: the same code paths for listing, sorting, saving and deleting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRecords, saveRecord, deleteRecord, persistent, packPoints, unpackPoints, listEquipment, saveEquipment, deleteEquipment } from '../src/store.js';
import { emptyRecord } from '../src/records.js';

test('without IndexedDB, records are kept in memory and the app is told', async () => {
  assert.equal(await persistent(), false);
});

test('save, list newest first, and delete', async () => {
  const a = { ...emptyRecord(), id: 'a' }; a.job = { ...a.job, date: '2026-06-01' };
  const b = { ...emptyRecord(), id: 'b' }; b.job = { ...b.job, date: '2026-06-14' };
  await saveRecord(a); await saveRecord(b);
  assert.deepEqual((await listRecords()).map(r => r.id), ['b', 'a']);
  await deleteRecord('a'); await deleteRecord('b');
  assert.deepEqual(await listRecords(), []);
});

test('a stored record missing its job (or damaged) does not break the list', async () => {
  const good = { ...emptyRecord(), id: 'good' };
  await saveRecord(good);
  await saveRecord({ id: 'nojob' });                       // old or damaged: no job at all
  await saveRecord({ id: 'badjob', job: { date: 20260614 } }); // date is not a string
  const ids = (await listRecords()).map(r => r.id).sort();
  assert.deepEqual(ids, ['badjob', 'good', 'nojob']);
  for (const id of ids) await deleteRecord(id);
});

test('saving copies the record, so later edits do not leak into the store', async () => {
  const r = { ...emptyRecord(), id: 'copy' };
  await saveRecord(r);
  r.job.field = 'changed after save';
  assert.equal((await listRecords())[0].job.field, '');
  await deleteRecord('copy');
});

test('flight points pack into columns and come back the same, including points without times', () => {
  const pts = [
    { t: 1000, lat: 43.3000001, lon: -97.9, flowLpm: 4.5, spray: true, flight: '1' },
    { t: null, lat: 43.3001, lon: -97.9001, flowLpm: NaN, spray: false, flight: '2' },
  ];
  const back = unpackPoints(JSON.parse(JSON.stringify(packPoints(pts))));
  assert.equal(back[0].t, 1000); assert.equal(back[0].flowLpm, 4.5); assert.equal(back[0].spray, true);
  assert.equal(back[1].t, null); assert.ok(Number.isNaN(back[1].flowLpm)); assert.equal(back[1].flight, '2');
});

test('saved equipment: save, update in place, delete', async () => {
  await saveEquipment({ id: 'e1', name: 'Big Deere', kind: 'ground' });
  await saveEquipment({ id: 'e1', name: 'Big Deere 2', kind: 'ground' });
  const list = await listEquipment();
  assert.equal(list.length, 1); assert.equal(list[0].name, 'Big Deere 2'); assert.ok(list[0].updatedAt);
  await deleteEquipment('e1');
  assert.deepEqual(await listEquipment(), []);
});

test('business settings (the logo): save, read back, remove', async () => {
  const { getSetting, setSetting } = await import('../src/store.js');
  assert.equal(await getSetting('logo'), null);
  await setSetting('logo', { dataUrl: 'data:image/png;base64,AAAA', width: 2, height: 1 });
  assert.deepEqual(await getSetting('logo'), { dataUrl: 'data:image/png;base64,AAAA', width: 2, height: 1 });
  await setSetting('logo', null);
  assert.equal(await getSetting('logo'), null);
});
