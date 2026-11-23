// Saved records live in the browser's IndexedDB. If IndexedDB is unavailable (private windows, some
// embedded viewers) records are kept in memory for the session and the UI says so.

const DB = 'sprayledger', STORE = 'records', EQUIPMENT = 'equipment', SETTINGS = 'settings';
let dbp = null, memory = null, memoryEq = null, memorySet = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    try {
      // Version 2 adds saved equipment, version 3 business settings (the logo); saved jobs are kept as they are.
      const req = indexedDB.open(DB, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(EQUIPMENT)) db.createObjectStore(EQUIPMENT, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  }).catch(() => { memory = new Map(); memoryEq = new Map(); memorySet = new Map(); return null; });
  return dbp;
}

function tx(db, mode, fn, store = STORE) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function persistent() { await open(); return memory === null; }

export async function listRecords() {
  const db = await open();
  const all = db ? await tx(db, 'readonly', s => s.getAll()) : [...memory.values()];
  // A damaged or very old saved record must not stop the whole list from opening.
  const date = r => (r && r.job && typeof r.job.date === 'string' ? r.job.date : '');
  return all.filter(r => r && typeof r === 'object' && r.id).sort((a, b) => date(b).localeCompare(date(a)) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function saveRecord(rec) {
  rec.updatedAt = Date.now();
  const copy = structuredClone(rec);
  const db = await open();
  if (db) await tx(db, 'readwrite', s => s.put(copy)); else memory.set(copy.id, copy);
  return rec;
}

export async function deleteRecord(id) {
  const db = await open();
  if (db) await tx(db, 'readwrite', s => s.delete(id)); else memory.delete(id);
}

/** Store flight points as parallel columns: roughly a third of the size of an array of objects. */
export function packPoints(points) {
  const cols = { t: [], lat: [], lon: [], flow: [], spray: [], flight: [] };
  for (const p of points) {
    cols.t.push(p.t); cols.lat.push(+p.lat.toFixed(7)); cols.lon.push(+p.lon.toFixed(7));
    cols.flow.push(Number.isFinite(p.flowLpm) ? +p.flowLpm.toFixed(3) : null);
    cols.spray.push(p.spray ? 1 : 0); cols.flight.push(p.flight);
  }
  return cols;
}

export function unpackPoints(c) {
  return c.t.map((t, i) => ({ t, lat: c.lat[i], lon: c.lon[i], flowLpm: c.flow[i] ?? NaN, spray: !!c.spray[i], flight: c.flight[i] }));
}

// ---------- saved equipment ("My equipment") ----------

export async function listEquipment() {
  const db = await open();
  const all = db ? await tx(db, 'readonly', s => s.getAll(), EQUIPMENT) : [...memoryEq.values()];
  return all.filter(p => p && p.id);
}

export async function saveEquipment(profile) {
  const copy = structuredClone({ ...profile, updatedAt: Date.now() });
  const db = await open();
  if (db) await tx(db, 'readwrite', s => s.put(copy), EQUIPMENT); else memoryEq.set(copy.id, copy);
  return copy;
}

export async function deleteEquipment(id) {
  const db = await open();
  if (db) await tx(db, 'readwrite', s => s.delete(id), EQUIPMENT); else memoryEq.delete(id);
}

// ---------- business settings (one value per key, e.g. the logo) ----------

export async function getSetting(key) {
  const db = await open();
  const row = db ? await tx(db, 'readonly', s => s.get(key), SETTINGS) : memorySet.get(key);
  return row?.value ?? null;
}

export async function setSetting(key, value) {
  const db = await open();
  const row = structuredClone({ key, value });
  if (value == null) { if (db) await tx(db, 'readwrite', s => s.delete(key), SETTINGS); else memorySet.delete(key); return; }
  if (db) await tx(db, 'readwrite', s => s.put(row), SETTINGS); else memorySet.set(key, row);
}
