// Saved records live in the browser's IndexedDB. If IndexedDB is unavailable (private windows, some
// embedded viewers) records are kept in memory for the session and the UI says so.

const DB = 'sprayledger', STORE = 'records';
let dbp = null, memory = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  }).catch(() => { memory = new Map(); return null; });
  return dbp;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function persistent() { await open(); return memory === null; }

export async function listRecords() {
  const db = await open();
  const all = db ? await tx(db, 'readonly', s => s.getAll()) : [...memory.values()];
  return all.sort((a, b) => (b.job.date || '').localeCompare(a.job.date || '') || b.updatedAt - a.updatedAt);
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
