// Application records: product math, compliance checks, intervals and CSV export.

export const UNITS = ['fl oz', 'pt', 'qt', 'gal', 'oz', 'lb', 'mL', 'L', 'g', 'kg'];

export function emptyRecord() {
  return {
    id: (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2)),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    job: { date: '', start: '', end: '', farm: '', field: '', parcels: '', landowner: '', crop: '', pest: '', acresOverride: '' },
    applicator: { name: '', cert: '', company: '' },
    equipment: { drone: '', serial: '', swathFt: 23, targetGpa: 2 },
    products: [{ name: '', epa: '', rate: '', unit: 'fl oz', rei: '', phi: '' }],
    conditions: { wind: '', windDir: '', temp: '', humidity: '' },
    notes: '',
    volumeGalOverride: '',
    sourceFiles: [],
    log: null,       // { points: compact columns, boundary }
    summary: null,   // filled from the coverage analysis
  };
}

const num = v => (v === '' || v == null ? NaN : Number(v));

export function acresTreated(rec) {
  const o = num(rec.job.acresOverride);
  return Number.isFinite(o) ? o : rec.summary?.acresTreated ?? NaN;
}

export function volumeGal(rec) {
  const o = num(rec.volumeGalOverride);
  return Number.isFinite(o) ? o : rec.summary?.volumeGal ?? NaN;
}

/**
 * Amount of one product actually applied.
 * With a measured spray volume and the target carrier rate we know the tank-mix concentration
 * (label rate ÷ target gal/ac), so product applied = concentration × gallons actually sprayed.
 * Without a measured volume we fall back to label rate × acres treated.
 */
export function productTotals(p, rec) {
  const rate = num(p.rate), ac = acresTreated(rec), gal = volumeGal(rec), gpa = num(rec.equipment.targetGpa);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  let total, method;
  if (Number.isFinite(gal) && gal > 0 && Number.isFinite(gpa) && gpa > 0) { total = (rate / gpa) * gal; method = 'measured'; }
  else if (Number.isFinite(ac)) { total = rate * ac; method = 'label'; }
  else return null;
  return { total, unit: p.unit, actualRate: Number.isFinite(ac) && ac > 0 ? total / ac : NaN, method };
}

function at(dateStr, timeStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T${timeStr || '00:00'}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Restricted-entry interval: no entry until the application ends plus the longest REI in the mix. */
export function reentryTime(rec) {
  const reis = rec.products.map(p => num(p.rei)).filter(Number.isFinite);
  const end = at(rec.job.date, rec.job.end || rec.job.start);
  if (!reis.length || !end) return null;
  return new Date(end.getTime() + Math.max(...reis) * 3600_000);
}

/** Pre-harvest interval: earliest harvest date is the application date plus the longest PHI. */
export function harvestDate(rec) {
  const phis = rec.products.map(p => num(p.phi)).filter(Number.isFinite);
  const d = at(rec.job.date);
  if (!phis.length || !d) return null;
  d.setDate(d.getDate() + Math.max(...phis));
  return d;
}

/**
 * Items the US federal restricted-use pesticide recordkeeping rule (7 CFR Part 110) lists.
 * Many states require more (time, wind, temperature), so those are checked too and marked as state items.
 */
export function complianceCheck(rec) {
  const has = v => v != null && String(v).trim() !== '';
  const prods = rec.products.filter(p => has(p.name));
  const items = [
    { label: 'Applicator name', ok: has(rec.applicator.name), scope: 'federal' },
    { label: 'Applicator certification number', ok: has(rec.applicator.cert), scope: 'federal' },
    { label: 'Date of application', ok: has(rec.job.date), scope: 'federal' },
    { label: 'Product name', ok: prods.length > 0, scope: 'federal' },
    { label: 'EPA registration number', ok: prods.length > 0 && prods.every(p => has(p.epa)), scope: 'federal' },
    { label: 'Total amount applied', ok: prods.length > 0 && prods.every(p => productTotals(p, rec)), scope: 'federal' },
    { label: 'Location (field and GPS)', ok: has(rec.job.field) && rec.summary?.lat != null, scope: 'federal' },
    { label: 'Crop, commodity or site', ok: has(rec.job.crop), scope: 'federal' },
    { label: 'Size of area treated', ok: Number.isFinite(acresTreated(rec)), scope: 'federal' },
    { label: 'Start and end time', ok: has(rec.job.start) && has(rec.job.end), scope: 'state' },
    { label: 'Wind speed and direction', ok: has(rec.conditions.wind) && has(rec.conditions.windDir), scope: 'state' },
    { label: 'Air temperature', ok: has(rec.conditions.temp), scope: 'state' },
  ];
  return { items, missing: items.filter(i => !i.ok), complete: items.every(i => i.ok) };
}

// ---------- formatting ----------

export const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
export const pad2 = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const hhmm = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
export function fmtDateTime(d) {
  return d ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}
export function fmtDate(d) {
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

// ---------- CSV export: one row per product per application ----------

const CSV_COLUMNS = [
  'Date', 'Start', 'End', 'Farm / customer', 'Field', 'Parcel no(s).', 'Land owner', 'Latitude', 'Longitude', 'Crop / site', 'Target pest',
  'Acres treated', 'Field acres', 'Coverage %', 'Skipped acres', 'Overlap acres', 'Off-target acres',
  'Product', 'EPA Reg. No.', 'Label rate', 'Rate unit', 'Total product applied', 'Actual rate / ac', 'Amount basis',
  'Spray volume (gal)', 'Spray volume (gal/ac)', 'REI (h)', 'Re-entry allowed', 'PHI (days)', 'Harvest not before',
  'Applicator', 'Certification no.', 'Company', 'Drone', 'Serial / registration', 'Swath (ft)',
  'Wind (mph)', 'Wind from', 'Temp (°F)', 'Humidity (%)', 'Notes',
];

const esc = v => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function recordsToCSV(records) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of records) {
    const s = r.summary || {};
    const ac = acresTreated(r), gal = volumeGal(r);
    const re = reentryTime(r), hv = harvestDate(r);
    const prods = r.products.filter(p => p.name) .length ? r.products.filter(p => p.name) : [{ name: '', epa: '', rate: '', unit: '', rei: '', phi: '' }];
    for (const p of prods) {
      const t = productTotals(p, r);
      lines.push([
        r.job.date, r.job.start, r.job.end, r.job.farm, r.job.field, r.job.parcels ?? '', r.job.landowner ?? '',
        s.lat?.toFixed(6) ?? '', s.lon?.toFixed(6) ?? '', r.job.crop, r.job.pest,
        fmtN(ac, 2), fmtN(s.fieldAcres, 2), fmtN(s.coveragePct, 1), fmtN(s.skipAcres, 2), fmtN(s.overlapAcres, 2), fmtN(s.offTargetAcres, 2),
        p.name, p.epa, p.rate, p.unit ? `${p.unit}/ac` : '', t ? fmtN(t.total, 2) + ' ' + t.unit : '', t ? fmtN(t.actualRate, 2) : '',
        t ? (t.method === 'measured' ? 'Measured spray volume' : 'Label rate × acres') : '',
        fmtN(gal, 2), fmtN(gal / ac, 2), p.rei, re ? `${isoDate(re)} ${hhmm(re)}` : '', p.phi, hv ? isoDate(hv) : '',
        r.applicator.name, r.applicator.cert, r.applicator.company, r.equipment.drone, r.equipment.serial, r.equipment.swathFt,
        r.conditions.wind, r.conditions.windDir, r.conditions.temp, r.conditions.humidity, r.notes,
      ].map(esc).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

const fmtN = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '');
