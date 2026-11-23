// Application records: product math, South Dakota record check, intervals and CSV export.
//
// South Dakota rules (ARSD 12:56:07, current text):
//   :01  eleven items every applicator must record for each application (checked below)
//   :02  records completed and available to the department at the close of each day
//   :03  kept three years from the application date; a copy to the department on request
//   :04  a commercial applicator gives the customer a record on written request
//   :05  the department may ask for a yearly summary by county
// The federal restricted-use recordkeeping rule (7 CFR Part 110) was rescinded by USDA effective July 11, 2025
// (90 FR 20083), so the state rule above is what these records follow.

export const UNITS = ['fl oz', 'pt', 'qt', 'gal', 'oz', 'lb', 'mL', 'L', 'g', 'kg'];
const LIQUID_TO_GAL = { 'fl oz': 1 / 128, pt: 1 / 8, qt: 1 / 4, gal: 1, mL: 1 / 3785.411784, L: 1 / 3.785411784 };
const DRY_TO_LB = { oz: 1 / 16, lb: 1, g: 1 / 453.59237, kg: 2.20462262 };

export const blankProduct = () => ({ name: '', common: '', company: '', epa: '', ai: '', rate: '', unit: 'fl oz', rei: '', phi: '', rup: false, kind: '', invoiceCost: '' });

/** Adjuvants (surfactants, oils, AMS…) go in the tank but aren't pesticides, so the pesticide label items don't apply. */
export function isAdjuvant(p) {
  if (p.kind) return p.kind === 'adjuvant';
  return /surfactant|crop oil|seed oil|ammonium sulfate|adjuvant|drift (control|retard)|defoamer|\b(NIS|COC|MSO|AMS|HSOC)\b/i.test(`${p.name} ${p.common}`) && !p.epa;
}
const pesticides = rec => rec.products.filter(p => String(p.name || '').trim() && !isAdjuvant(p));

export function emptyRecord() {
  return {
    id: (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2)),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    job: {
      date: '', start: '', end: '', farm: '', customerAddress: '', field: '', legal: '',
      parcels: '', landowner: '', crop: '', pest: '', acresOverride: '',
    },
    // payment: how the customer pays (printed on invoices); carried to new jobs with the rest of the business details
    applicator: { name: '', cert: '', company: '', phone: '', address: '', payment: '' },
    equipment: { model: '', kind: '', base: '', name: '', drone: '', serial: '', swathFt: 23, targetGpa: 2, tankGal: '', flowGpm: '', speedMph: '' },
    products: [blankProduct()],
    conditions: { wind: '', windDir: '', temp: '', humidity: '', source: '' },
    notes: '',
    volumeGalOverride: '',
    // ratePerAcre is typed in; total is kept up to date by the app (and recomputed for the spreadsheet).
    invoice: { number: '', ratePerAcre: '', total: 0 },
    sourceFiles: [],
    log: null,       // { points: compact columns, boundary }
    summary: null,   // filled from the coverage analysis
  };
}

/** Bring a record saved by an older version up to the current shape. */
export function normalizeRecord(rec) {
  const base = emptyRecord();
  for (const k of ['job', 'applicator', 'equipment', 'conditions']) rec[k] = { ...base[k], ...(rec[k] || {}) };
  rec.products = (rec.products?.length ? rec.products : base.products).map(p => ({ ...blankProduct(), ...p }));
  for (const k of ['notes', 'volumeGalOverride']) rec[k] ??= base[k];
  rec.sourceFiles ??= [];
  rec.invoice = { ...base.invoice, ...(rec.invoice || {}) };
  return rec;
}

const num = v => (v === '' || v == null ? NaN : Number(v));
const has = v => v != null && String(v).trim() !== '';

export function acresTreated(rec) {
  const o = num(rec.job.acresOverride);
  return Number.isFinite(o) ? o : rec.summary?.acresTreated ?? NaN;
}

export function volumeGal(rec) {
  const o = num(rec.volumeGalOverride);
  return Number.isFinite(o) ? o : rec.summary?.volumeGal ?? NaN;
}

/** Convert an amount to gallons (liquids) or pounds (dry), as the state form asks. */
export function toGalOrLb(amount, unit) {
  if (unit in LIQUID_TO_GAL) return { value: amount * LIQUID_TO_GAL[unit], unit: 'gal' };
  if (unit in DRY_TO_LB) return { value: amount * DRY_TO_LB[unit], unit: 'lb' };
  return { value: amount, unit };
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
  return { total, unit: p.unit, actualRate: Number.isFinite(ac) && ac > 0 ? total / ac : NaN, method, galOrLb: toGalOrLb(total, p.unit) };
}

function at(dateStr, timeStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T${timeStr || '00:00'}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pesticides in the tank whose re-entry interval hasn't been entered. */
export function missingRei(rec) {
  return pesticides(rec).filter(p => !Number.isFinite(num(p.rei)));
}

/** When the job finished; a finish time earlier than the start means the job ran past midnight. */
function finishedAt(rec) {
  const end = at(rec.job.date, rec.job.end || rec.job.start);
  if (end && rec.job.start && rec.job.end && rec.job.end < rec.job.start) end.setDate(end.getDate() + 1);
  return end;
}

/**
 * Restricted-entry interval: no entry until the application ends plus the longest REI in the mix.
 * Unknown (null) when any pesticide's REI is missing: a shorter REI from the other products must never stand in.
 */
export function reentryTime(rec) {
  const ps = pesticides(rec);
  const end = finishedAt(rec);
  if (!ps.length || !end || missingRei(rec).length) return null;
  return new Date(end.getTime() + Math.max(...ps.map(p => num(p.rei))) * 3600_000);
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
 * The eleven items of ARSD 12:56:07:01 (checked against the current rule text), the applicator license
 * number the state form asks for, the re-entry interval of every pesticide (so the safety date is right),
 * and the EPA Reg. No. of any restricted-use product. Adjuvants aren't held to the pesticide items.
 */
export function complianceCheck(rec) {
  const prods = pesticides(rec);
  const all = f => prods.length > 0 && prods.every(f);
  const located = rec.summary?.lat != null || has(rec.job.legal) || !!rec.log?.boundary?.length;
  const items = [
    { ref: '1', label: 'Customer name and address', ok: has(rec.job.farm) && has(rec.job.customerAddress), step: 'finish' },
    { ref: '2', label: 'Location (GPS or legal description)', ok: located, step: 'field' },
    { ref: '3', label: 'Pest treated', ok: has(rec.job.pest), step: 'finish' },
    { ref: '4', label: 'Acres treated', ok: Number.isFinite(acresTreated(rec)), step: 'spray' },
    { ref: '5', label: 'Date and start and finish time', ok: has(rec.job.date) && has(rec.job.start) && has(rec.job.end), step: 'finish' },
    { ref: '6', label: 'Who applied it', ok: has(rec.applicator.name), step: 'finish' },
    { ref: '7', label: 'Product trade name and common name', ok: all(p => has(p.common)), step: 'products' },
    { ref: '8', label: 'Company name on the label', ok: all(p => has(p.company)), step: 'products' },
    { ref: '9', label: 'Wind direction, wind speed, temperature', ok: has(rec.conditions.windDir) && has(rec.conditions.wind) && has(rec.conditions.temp), step: 'finish' },
    { ref: '10', label: 'Amount applied and concentration', ok: all(p => productTotals(p, rec) && has(p.ai)), step: 'products' },
    { ref: '11', label: 'Crop or site treated', ok: has(rec.job.crop), step: 'finish' },
    { ref: 'form', label: 'Applicator license (AP) number', ok: has(rec.applicator.cert), step: 'finish' },
    // Not one of the rule's eleven items (item 6 is only who applied it), but asked for so the record
    // shows how to reach the applicator: a record without it is not marked complete.
    { ref: 'addr', label: 'Applicator business address', ok: has(rec.applicator.address), step: 'finish' },
    { ref: 'REI', label: 'Re-entry hours for every pesticide', ok: prods.length > 0 && !missingRei(rec).length, step: 'products' },
  ];
  if (prods.some(p => p.rup)) {
    items.push({ ref: 'RUP', label: 'EPA Reg. No. for restricted-use products', ok: prods.filter(p => p.rup).every(p => has(p.epa)), step: 'products' });
  }
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
/** "14:05" → "2:05 PM" */
export function clock(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad2(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------- CSV export: one row per product per application ----------

// ---------- invoice ----------

const money = v => { const n = num(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const cents = v => Math.round(v * 100) / 100;

/**
 * The invoice for a job: acres sprayed x rate per acre, plus what the applicator charges for each product.
 * Blank, negative or non-numeric amounts count as $0. Unknown acres count as 0 (acresKnown says so).
 * Billed acres are rounded to 2 decimals, as printed, so the customer can check acres × rate themselves,
 * and are never below 0 (a negative typed into the acres box bills nothing, not a credit).
 */
export function invoiceTotals(rec) {
  const measured = acresTreated(rec);
  const acresKnown = Number.isFinite(measured);
  const acres = acresKnown ? Math.max(0, cents(measured)) + 0 : NaN; // + 0 turns -0 into 0
  const rate = money(rec.invoice?.ratePerAcre);
  const application = cents((acresKnown ? acres : 0) * rate);
  const lines = rec.products.filter(p => String(p.name || '').trim()).map(p => ({ product: p, used: productTotals(p, rec), cost: cents(money(p.invoiceCost)) }));
  const productCost = cents(lines.reduce((s, l) => s + l.cost, 0));
  return { acres, acresKnown, rate, application, lines, productCost, total: cents(application + productCost) };
}

/**
 * The next invoice number: the newest saved invoice number with its last digits counted up (keeping any
 * prefix and leading zeros, so "2026-014" is followed by "2026-015"), skipping numbers already used.
 * 1001 when no job has an invoice number yet.
 */
export function nextInvoiceNumber(records) {
  const used = new Set(records.map(r => String(r.invoice?.number || '').trim()).filter(Boolean));
  const newest = [...records].filter(r => String(r.invoice?.number || '').trim()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  let n = newest ? String(newest.invoice.number).trim() : '1000';
  const bump = s => {
    const m = s.match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return `${s}-1`;
    const next = String(Number(m[2]) + 1).padStart(m[2].length, '0');
    return m[1] + next + m[3];
  };
  do n = bump(n); while (used.has(n));
  return n;
}

/** Other saved jobs that already use this invoice number. */
export function invoiceNumberTaken(records, rec) {
  const n = String(rec.invoice?.number || '').trim();
  return !!n && records.some(r => r.id !== rec.id && String(r.invoice?.number || '').trim() === n);
}

/** Dollars for the invoice. Invoice amounts are never negative, so anything that isn't a positive number shows as $0.00. */
export const fmtMoney = v => '$' + (Number.isFinite(v) && v > 0 ? v : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CSV_COLUMNS = [
  'Date', 'Start', 'Finish', 'Customer', 'Customer address', 'Field', 'Legal description', 'Parcel no(s).', 'Land owner',
  'Latitude', 'Longitude', 'Crop / site', 'Pest(s)',
  'Acres treated', 'Field acres', 'Coverage %', 'Skipped acres', 'Overlap acres', 'Off-target acres',
  'Product (trade name)', 'Common name', 'Company on label', 'EPA Reg. No.', 'Restricted use', 'A.i. per unit',
  'Label rate', 'Rate unit', 'Total product applied', 'Total (gal or lb)', 'Actual rate / ac', 'Amount basis',
  'Spray volume (gal)', 'Spray volume (gal/ac)', 'REI (h)', 'Re-entry allowed', 'PHI (days)', 'Harvest not before',
  'Applicator', 'Applicator license (AP) no.', 'Company', 'Drone or sprayer', 'Serial / registration', 'Swath (ft)',
  'Wind (mph)', 'Wind from', 'Temp (°F)', 'Humidity (%)', 'Weather source', 'Notes',
  'invoice_rate_per_acre', 'invoice_total', 'invoice_number',
];

const esc = v => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function recordsToCSV(records) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const raw of records) {
    const r = normalizeRecord(structuredClone(raw));
    const s = r.summary || {};
    const ac = acresTreated(r), gal = volumeGal(r);
    const re = reentryTime(r), hv = harvestDate(r);
    const inv = invoiceTotals(r);
    const prods = r.products.filter(p => p.name).length ? r.products.filter(p => p.name) : [blankProduct()];
    for (const p of prods) {
      const t = productTotals(p, r);
      lines.push([
        r.job.date, r.job.start, r.job.end, r.job.farm, r.job.customerAddress, r.job.field, r.job.legal, r.job.parcels, r.job.landowner,
        s.lat?.toFixed(6) ?? '', s.lon?.toFixed(6) ?? '', r.job.crop, r.job.pest,
        fmtN(ac, 2), fmtN(s.fieldAcres, 2), fmtN(s.coveragePct, 1), fmtN(s.skipAcres, 2), fmtN(s.overlapAcres, 2), fmtN(s.offTargetAcres, 2),
        p.name, p.common, p.company, p.epa, p.rup ? 'Yes' : 'No', p.ai,
        p.rate, p.unit ? `${p.unit}/ac` : '', t ? fmtN(t.total, 2) + ' ' + t.unit : '', t ? `${fmtN(t.galOrLb.value, 3)} ${t.galOrLb.unit}` : '',
        t ? fmtN(t.actualRate, 2) : '', t ? (t.method === 'measured' ? 'Measured spray volume' : 'Label rate × acres') : '',
        fmtN(gal, 2), fmtN(gal / ac, 2), p.rei, re ? `${isoDate(re)} ${hhmm(re)}` : '', p.phi, hv ? isoDate(hv) : '',
        r.applicator.name, r.applicator.cert, r.applicator.company, r.equipment.drone, r.equipment.serial, r.equipment.swathFt,
        r.conditions.wind, r.conditions.windDir, r.conditions.temp, r.conditions.humidity, r.conditions.source, r.notes,
        inv.rate.toFixed(2), inv.total.toFixed(2), r.invoice.number,
      ].map(esc).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

const fmtN = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '');
