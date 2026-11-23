// End-of-job documents as PDF files: a plain-language report for the customer and the
// South Dakota application record (ARSD 12:56:07:01) for the applicator's files.
// Uses jsPDF (vendored, window.jspdf).

import { isGround } from './equipment.js';
import {
  productTotals, reentryTime, harvestDate, acresTreated, volumeGal, complianceCheck, missingRei,
  fmt, fmtDate, fmtDateTime, clock,
} from './records.js';

const PAGE = { w: 612, h: 792, m: 46 };           // US Letter, points
const INK = [20, 24, 22], MUTED = [78, 86, 82], LINE = [190, 198, 192], ACCENT = [35, 96, 63];

class Writer {
  constructor(title) {
    const { jsPDF } = window.jspdf;
    this.doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    this.doc.setProperties({ title, creator: 'SprayLedger' });
    this.y = PAGE.m;
    this.title = title;
  }
  get width() { return PAGE.w - 2 * PAGE.m; }
  room(h) { if (this.y + h > PAGE.h - PAGE.m - 24) { this.doc.addPage(); this.y = PAGE.m; } }
  font(size, style = 'normal', color = INK) { this.doc.setFont('helvetica', style); this.doc.setFontSize(size); this.doc.setTextColor(...color); }
  text(str, { size = 12, style = 'normal', color = INK, x = PAGE.m, width = this.width, gap = 4 } = {}) {
    this.font(size, style, color);
    const lines = this.doc.splitTextToSize(String(str ?? ''), width);
    const lh = size * 1.32;
    this.room(lines.length * lh);
    this.doc.text(lines, x, this.y + size);
    this.y += lines.length * lh + gap;
  }
  heading(str, size = 15) {
    this.room(size * 3 + 48); // keep a heading with at least two lines of what follows
    this.y += 8;
    this.text(str, { size, style: 'bold', color: ACCENT, gap: 2 });
    this.doc.setDrawColor(...LINE); this.doc.setLineWidth(0.8);
    this.doc.line(PAGE.m, this.y, PAGE.w - PAGE.m, this.y);
    this.y += 8;
  }
  /** Label/value pairs in `cols` columns. Empty values print as a blank line to fill in by hand. */
  fields(pairs, cols = 2) {
    const colW = this.width / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const row = pairs.slice(i, i + cols);
      const heights = row.map(([, v]) => { this.font(12); return this.doc.splitTextToSize(String(v || ' '), colW - 12).length; });
      const h = 13 + Math.max(...heights) * 15.5 + 8;
      this.room(h);
      row.forEach(([label, value], k) => {
        const x = PAGE.m + k * colW;
        this.font(9.5, 'bold', MUTED); this.doc.text(label.toUpperCase(), x, this.y + 9);
        this.font(12, 'normal', INK);
        if (value || value === 0) this.doc.text(this.doc.splitTextToSize(String(value), colW - 12), x, this.y + 25);
        else { this.doc.setDrawColor(...LINE); this.doc.line(x, this.y + 27, x + colW - 16, this.y + 27); }
      });
      this.y += h;
    }
  }
  /** Simple table; columns: [{ label, w (fraction) }], rows: arrays of strings. */
  table(columns, rows, { size = 10.5 } = {}) {
    const xs = []; let x = PAGE.m;
    for (const c of columns) { xs.push(x); x += c.w * this.width; }
    const drawHeader = () => {
      this.font(9, 'bold', MUTED);
      const hl = columns.map(c => this.doc.splitTextToSize(c.label.toUpperCase(), c.w * this.width - 6));
      const hh = Math.max(...hl.map(l => l.length)) * 11 + 6;
      this.room(hh + 20);
      hl.forEach((l, i) => this.doc.text(l, xs[i], this.y + 9));
      this.y += hh;
      this.doc.setDrawColor(...INK); this.doc.setLineWidth(0.8); this.doc.line(PAGE.m, this.y, PAGE.w - PAGE.m, this.y);
      this.y += 4;
    };
    drawHeader();
    for (const r of rows) {
      this.font(size);
      const cells = r.map((v, i) => this.doc.splitTextToSize(String(v ?? '—'), columns[i].w * this.width - 6));
      const h = Math.max(...cells.map(c => c.length)) * size * 1.3 + 8;
      if (this.y + h > PAGE.h - PAGE.m - 24) { this.doc.addPage(); this.y = PAGE.m; drawHeader(); }
      this.font(size, 'normal', INK);
      cells.forEach((c, i) => this.doc.text(c, xs[i], this.y + size + 1));
      this.y += h;
      this.doc.setDrawColor(...LINE); this.doc.setLineWidth(0.5); this.doc.line(PAGE.m, this.y - 3, PAGE.w - PAGE.m, this.y - 3);
    }
    this.y += 6;
  }
  box(lines, { color = ACCENT } = {}) {
    const pad = 12, lh = 19;
    const h = pad * 2 + lines.length * lh;
    this.room(h + 6);
    this.doc.setDrawColor(...color); this.doc.setLineWidth(2);
    this.doc.roundedRect(PAGE.m, this.y, this.width, h, 6, 6, 'S');
    lines.forEach(([label, value], i) => {
      const yy = this.y + pad + 14 + i * lh;
      this.font(13, 'bold', INK); this.doc.text(label, PAGE.m + pad, yy);
      this.font(13, 'normal', INK); this.doc.text(String(value), PAGE.m + pad + 210, yy);
    });
    this.y += h + 10;
  }
  image(dataUrl, aspect, caption, maxH = 330) {
    if (!dataUrl) return;
    const w = this.width, h = Math.min(w / aspect, maxH);
    const ww = h * aspect;
    this.room(h + 30);
    // Compressed so the PDF stays small enough to text or email (uncompressed, one map is about 3 MB).
    this.doc.addImage(dataUrl, 'PNG', PAGE.m + (w - ww) / 2, this.y, ww, h, undefined, 'FAST');
    this.y += h + 4;
    if (caption) this.text(caption, { size: 10, color: MUTED });
  }
  footer(left) {
    const n = this.doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i);
      this.font(9, 'normal', MUTED);
      this.doc.text(left, PAGE.m, PAGE.h - 24);
      this.doc.text(`Page ${i} of ${n}`, PAGE.w - PAGE.m, PAGE.h - 24, { align: 'right' });
    }
  }
}

const join = (...parts) => parts.filter(p => p != null && String(p).trim() !== '').join(', ');
const dash = v => (v == null || String(v).trim() === '' ? '' : String(v));
const timeRange = r => (r.job.start ? `${clock(r.job.start)} to ${clock(r.job.end) || '—'}` : '');
const ymd = r => (r.job.date ? r.job.date.replaceAll('-', ' / ') : '');
const appDate = r => (r.job.date ? fmtDate(new Date(`${r.job.date}T00:00`)) : '');

function businessHeader(w, r) {
  const a = r.applicator;
  if (a.company) w.text(a.company, { size: 18, style: 'bold', gap: 0 });
  const contact = join(a.address, a.phone && `Phone ${a.phone}`);
  if (contact) w.text(contact, { size: 11, color: MUTED });
}

function productRows(r) {
  return r.products.filter(p => p.name).map(p => ({ p, t: productTotals(p, r) }));
}

/** Plain-language report for the customer. `ctx` = { map: { dataUrl, aspect }, gaps: [{acres, lat, lon}] } */
export function customerReport(r, ctx = {}) {
  const w = new Writer(`Spray application report: ${r.job.field || 'field'} ${r.job.date}`);
  const s = r.summary || {};
  businessHeader(w, r);
  w.y += 6;
  w.text('Spray Application Report', { size: 24, style: 'bold', color: ACCENT, gap: 2 });
  w.text(join(r.job.field && `Field: ${r.job.field}`, appDate(r)), { size: 14, gap: 10 });

  const re = reentryTime(r), hv = harvestDate(r);
  const safety = [];
  if (re) safety.push(['Keep people out until:', fmtDateTime(re)]);
  else if (missingRei(r).length) safety.push(['Keep people out until:', 'See the product labels (re-entry hours not entered)']);
  if (hv) safety.push(['Do not harvest before:', fmtDate(hv)]);
  if (safety.length) w.box(safety, { color: [176, 48, 47] });

  w.heading('Prepared for');
  w.fields([['Customer', r.job.farm], ['Address', r.job.customerAddress], ['Field', r.job.field], ['Legal description', r.job.legal]]);

  w.heading('What was applied');
  const rows = productRows(r);
  if (rows.length) {
    w.table(
      [{ label: 'Product', w: 0.27 }, { label: 'Active ingredient', w: 0.23 }, { label: 'Rate per acre', w: 0.16 }, { label: 'Total used', w: 0.18 }, { label: 'Re-entry / harvest', w: 0.16 }],
      rows.map(({ p, t }) => [
        p.name, dash(p.common),
        t && Number.isFinite(t.actualRate) ? `${fmt(t.actualRate, 2)} ${p.unit}` : `${p.rate} ${p.unit}`,
        t ? `${fmt(t.total, 1)} ${p.unit}` : '—',
        join(p.rei && `${p.rei} h`, p.phi && `${p.phi} days`) || '—',
      ]),
      { size: 11.5 },
    );
  } else w.text('No products entered.', { color: MUTED });

  w.heading('The job');
  const ac = acresTreated(r), gal = volumeGal(r);
  w.fields([
    ['Date', appDate(r)], ['Time', timeRange(r)],
    ['Crop', r.job.crop], ['Pest', r.job.pest],
    ['Acres sprayed', Number.isFinite(ac) ? `${fmt(ac, 2)} acres` : ''], ['Spray volume', Number.isFinite(gal) ? `${fmt(gal, 1)} gallons (${fmt(gal / ac, 2)} gal per acre)` : ''],
    ['Field covered', s.coveragePct != null ? `${fmt(s.coveragePct, 1)}% of the field` : ''], ['Equipment', join(r.equipment.drone, r.equipment.swathFt && `${r.equipment.swathFt} ft ${isGround(r.equipment) ? 'boom' : 'swath'}`)],
  ]);
  if (s.hasBoundary && s.skipAcres >= 0.05) {
    w.text(`The GPS record shows ${fmt(s.skipAcres, 2)} acres not sprayed${ctx.gaps?.length ? `, the largest ${ctx.gaps.length} spots numbered on the map` : ''}. Ask us about any that need a touch-up.`, { size: 11.5 });
  }

  w.heading('Applied by');
  w.fields([['Applicator', r.applicator.name], ['License no.', r.applicator.cert], ['Company', r.applicator.company], ['Phone', r.applicator.phone]]);

  w.heading('Weather while spraying');
  const c = r.conditions;
  w.fields([['Wind', c.wind ? `${c.wind} mph from the ${c.windDir || '—'}` : ''], ['Temperature', c.temp ? `${c.temp} °F` : ''], ['Humidity', c.humidity ? `${c.humidity}%` : ''], ['Source', c.source]]);

  if (ctx.map?.dataUrl) { w.heading('Coverage map'); w.image(ctx.map.dataUrl, ctx.map.aspect, 'Green: sprayed. Red: not sprayed. Orange: sprayed twice. Purple: outside the field. North is up.', 270); }
  if (r.notes) { w.heading('Notes'); w.text(r.notes); }
  w.y += 6;
  w.text('Please keep this report with your farm records. Call us with any questions about this application.', { size: 11, color: MUTED });
  w.footer(`Spray application report · ${r.job.field || ''} · ${r.job.date || ''}`);
  return w.doc;
}

/** The South Dakota application record, numbered like the state's recordkeeping form. */
export function stateRecord(r, ctx = {}) {
  const w = new Writer(`Pesticide application record ${r.job.date} ${r.job.field || ''}`);
  const s = r.summary || {};
  businessHeader(w, r);
  w.y += 4;
  w.text('Pesticide Application Record', { size: 22, style: 'bold', gap: 0 });
  w.text('South Dakota, ARSD 12:56:07:01. Required for general use, restricted use and 25(b) products.', { size: 11, color: MUTED, gap: 2 });
  w.text('Records must be completed by the close of the application day and kept for three years from the date of application. Provide a copy to the S.D. Department of Agriculture and Natural Resources on request (ARSD 12:56:07:02 and :03).', { size: 10, color: MUTED, gap: 6 });

  const check = complianceCheck(r);
  if (!check.complete) {
    w.box([['Not complete. Missing:', check.missing.slice(0, 1).map(m => m.label).join('')], ...check.missing.slice(1, 4).map(m => ['', m.label]), ...(check.missing.length > 4 ? [['', `and ${check.missing.length - 4} more`]] : [])], { color: [176, 48, 47] });
  }

  w.heading('(1) Person for whom the pesticide was applied', 13);
  w.fields([['Name', r.job.farm], ['Address', r.job.customerAddress], ['Land owner (county records)', r.job.landowner], ['Parcel no(s).', r.job.parcels]]);

  w.heading('(2) Location where the pesticide was applied', 13);
  w.fields([
    ['GPS coordinates (field centre)', s.lat != null ? `${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}` : ''],
    ['Legal land description (S-T-R)', r.job.legal],
    ['Field name', r.job.field], ['Field size (boundary)', s.hasBoundary ? `${fmt(s.fieldAcres, 2)} acres` : ''],
  ]);

  w.heading('(3) Pest(s) targeted   ·   (4) Size of area treated   ·   (11) Crop or site', 13);
  const ac = acresTreated(r);
  w.fields([['Pest(s), name from label', r.job.pest], ['Acres treated', Number.isFinite(ac) ? `${fmt(ac, 2)} acres` : ''], ['Crop, commodity or site', r.job.crop]], 3);

  w.heading('(5) Date and time   ·   (6) Applicator', 13);
  w.fields([['Year / month / day', ymd(r)], ['Start time', clock(r.job.start)], ['Finish time', clock(r.job.end)], ['Applicator name', r.applicator.name], ['Applicator license (AP) no.', r.applicator.cert], ['Business', r.applicator.company]], 3);

  w.heading('(7) Products   ·   (8) Company   ·   (10) Amount and concentration', 13);
  const rows = productRows(r);
  w.table(
    [{ label: 'Trade name', w: 0.19 }, { label: 'Common name (a.i.)', w: 0.17 }, { label: 'EPA Reg. No.', w: 0.12 }, { label: 'Company on label', w: 0.15 },
      { label: 'Total pesticide (gal or lb)', w: 0.14 }, { label: 'A.i. per unit', w: 0.11 }, { label: 'Rate per acre', w: 0.12 }],
    (rows.length ? rows : [{ p: { name: '' }, t: null }]).map(({ p, t }) => [
      `${p.name || ''}${p.rup ? ' (RUP)' : ''}`, dash(p.common), dash(p.epa), dash(p.company),
      t ? `${fmt(t.galOrLb.value, 3)} ${t.galOrLb.unit}` : '', dash(p.ai),
      t && Number.isFinite(t.actualRate) ? `${fmt(t.actualRate, 2)} ${p.unit}` : (p.rate ? `${p.rate} ${p.unit}` : ''),
    ]),
  );
  const gal = volumeGal(r);
  w.text(join(
    Number.isFinite(gal) && `Total spray volume ${fmt(gal, 1)} gal (${fmt(gal / ac, 2)} gal/ac)`,
    rows.some(x => x.t?.method === 'measured') && 'product amounts from the measured spray volume and tank-mix concentration',
  ), { size: 10, color: MUTED });

  w.heading('(9) Weather during application', 13);
  const c = r.conditions;
  w.fields([['Air temperature (°F)', c.temp], ['Wind direction (from)', c.windDir], ['Wind speed (mph)', c.wind], ['Source', c.source]], 4);
  w.text('The state form asks for wind speed at 6.5 feet above ground. Readings taken on site are the best record; modelled weather is usually reported at 33 feet.', { size: 9.5, color: MUTED });

  w.heading('Supporting information', 13);
  const re = reentryTime(r), hv = harvestDate(r);
  w.fields([
    ['Equipment', join(r.equipment.drone, r.equipment.serial)], [isGround(r.equipment) ? 'Boom width' : 'Swath', r.equipment.swathFt ? `${r.equipment.swathFt} ft` : ''],
    ['Re-entry allowed', re ? fmtDateTime(re) : ''], ['Earliest harvest', hv ? fmtDate(hv) : ''],
    ['GPS coverage of field', s.coveragePct != null ? `${fmt(s.coveragePct, 1)}%, ${fmt(s.skipAcres, 2)} ac missed, ${fmt(s.offTargetAcres, 2)} ac off target` : ''],
    ['Source of GPS record', (r.sourceFiles || []).join('; ')],
  ]);
  if (r.notes) { w.heading('Notes', 13); w.text(r.notes); }
  if (ctx.map?.dataUrl) w.image(ctx.map.dataUrl, ctx.map.aspect, 'Coverage map from the GPS record (a field map is optional on the state form). Green sprayed, red not sprayed, orange twice, purple off target. North is up.', 150);

  w.y += 18; w.room(60);
  w.doc.setDrawColor(...INK); w.doc.setLineWidth(0.8);
  w.doc.line(PAGE.m, w.y + 30, PAGE.m + 300, w.y + 30); w.doc.line(PAGE.m + 340, w.y + 30, PAGE.w - PAGE.m, w.y + 30);
  w.font(10, 'normal', MUTED); w.doc.text('Applicator signature', PAGE.m, w.y + 44); w.doc.text('Date', PAGE.m + 340, w.y + 44);
  w.y += 56;
  w.text('Additional records may be required by a pesticide label and must be kept with this record.', { size: 9.5, color: MUTED });
  w.footer(`SD pesticide application record · ${r.job.date || ''} · keep until ${r.job.date ? `${Number(r.job.date.slice(0, 4)) + 3}${r.job.date.slice(4)}` : '3 years after application'} · ID ${String(r.id).slice(0, 8)}`);
  return w.doc;
}

export function fileName(kind, r) {
  const safe = s => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${r.job.date || 'undated'}-${safe(r.job.field) || 'field'}-${kind}.pdf`;
}

/**
 * Hand a PDF to the user the easiest way the device allows:
 * the phone's share menu (text, email…), else a download.
 * Returns 'shared', 'saved', 'cancelled' or throws.
 */
export async function deliverPdf(doc, name, { title, text, noShare = false } = {}) {
  const blob = doc.output('blob');
  const file = new File([blob], name, { type: 'application/pdf' });
  if (!noShare && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; /* fall through to download */ }
  }
  const dl = await window.claude?.use?.('downloads').catch(() => null);
  if (dl) { await dl.save({ filename: name, data: blob }); return 'saved'; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'saved';
}
