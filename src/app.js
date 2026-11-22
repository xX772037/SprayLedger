import { parseFile } from './parse.js';
import { computeCoverage, acres } from './coverage.js';
import { M_PER_FT, L_PER_GAL } from './geo.js';
import {
  emptyRecord, UNITS, productTotals, reentryTime, harvestDate, complianceCheck, recordsToCSV,
  fmt, isoDate, hhmm, fmtDateTime, fmtDate, acresTreated, volumeGal,
} from './records.js';
import { listRecords, saveRecord, deleteRecord, packPoints, unpackPoints, persistent } from './store.js';
import { sampleJob } from './sample.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Embedded previews block printing and file downloads, so those controls only show on a normal page.
const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();

const state = {
  records: [],
  rec: emptyRecord(),
  points: [],
  boundary: [],
  analysis: null,
  notices: [],
  dirty: false,
  draw: null,        // { pts: [[x, y], ...] } in map metres while drawing a boundary
  view: null,
  img: null,
};

const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

// ---------------------------------------------------------------- analysis

function analyze() {
  if (!state.points.length) { state.analysis = null; state.rec.summary = null; state.img = null; return; }
  const swathM = (Number(state.rec.equipment.swathFt) || 23) * M_PER_FT;
  const a = computeCoverage({ points: state.points, boundary: state.boundary, swathM });
  const s = a.stats;
  state.analysis = a;
  state.img = null;
  state.rec.summary = {
    fieldAcres: acres(s.fieldM2),
    acresTreated: acres(s.coveredM2),
    coveragePct: s.coveragePct,
    overlapAcres: acres(s.overlapM2),
    skipAcres: acres(s.skippedM2),
    offTargetAcres: acres(s.offTargetM2),
    volumeGal: s.volumeL == null ? null : s.volumeL / L_PER_GAL,
    sprayMinutes: s.sprayMinutes,
    flights: a.flights.length,
    lat: a.proj.lat0, lon: a.proj.lon0,
    hasBoundary: a.hasBoundary,
    start: a.start, end: a.end,
  };
  const MISMATCH = 'The field boundary does not overlap';
  state.notices = state.notices.filter(n => !n.text.startsWith(MISMATCH));
  if (a.hasBoundary && s.sprayedM2 > 0 && s.coveredM2 === 0) {
    state.notices.push({ text: 'The field boundary does not overlap any of the spraying. Check that the boundary and the flight log are for the same field.', err: true });
  }
}

function setTimesFromLog() {
  const a = state.analysis; if (!a) return;
  const s = new Date(a.start), e = new Date(a.end);
  state.rec.job.date = isoDate(s);
  state.rec.job.start = hhmm(s);
  state.rec.job.end = hhmm(e);
}

// ---------------------------------------------------------------- import

async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  state.notices = [];
  const tracks = [], boundaries = [], names = [];
  let relative = false;
  for (const f of files) {
    try {
      const r = parseFile(f.name, await f.text());
      if (r.boundary.length) boundaries.push(...r.boundary);
      if (r.points.length) tracks.push({ name: f.name, points: r.points });
      if (r.meta?.relativeTime) relative = true;
      r.warnings.forEach(w => state.notices.push({ text: `${f.name}: ${w}` }));
      if (!r.boundary.length && !r.points.length) state.notices.push({ text: `${f.name}: no flight track or field boundary found in this file.`, err: true });
      else names.push(f.name);
    } catch (e) {
      state.notices.push({ text: `${f.name}: ${e.message}`, err: true });
    }
  }
  if (tracks.length) {
    // Several logs (one per flight, as some apps export) become one job; keep their flights apart.
    state.points = tracks.flatMap((t, i) => tracks.length > 1 ? t.points.map(p => ({ ...p, flight: `${i + 1}.${p.flight}` })) : t.points);
    if (!relative) state.points.sort((a, b) => a.t - b.t);
    state.rec.sourceFiles = names;
  } else if (names.length) {
    state.rec.sourceFiles = [...new Set([...state.rec.sourceFiles, ...names])];
  }
  if (boundaries.length) state.boundary = boundaries;
  if (!state.points.length && boundaries.length) state.notices.push({ text: 'Boundary loaded. Now add the flight log for this field.' });
  syncLog();
  analyze();
  if (tracks.length && !relative) setTimesFromLog();
  markDirty();
  renderAll();
}

function syncLog() {
  state.rec.log = state.points.length || state.boundary.length ? { points: packPoints(state.points), boundary: state.boundary } : null;
}

// ---------------------------------------------------------------- map

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function rgb(hex) {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function coverageImage(a) {
  const key = cssVar('--cov') + cssVar('--field');
  if (state.img?.a === a && state.img.key === key) return state.img.canvas;
  const { W, H, count, inField } = a.grid;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const im = ctx.createImageData(W, H);
  const cov = rgb(cssVar('--cov')), ovl = rgb(cssVar('--ovl')), skip = rgb(cssVar('--skip')), off = rgb(cssVar('--off'));
  const d = im.data;
  for (let j = 0; j < H; j++) {
    const row = (H - 1 - j) * W; // north up
    for (let i = 0; i < W; i++) {
      const cidx = j * W + i, n = count[cidx], f = a.hasBoundary ? inField[cidx] : 1;
      let col = null, alpha = 255;
      if (f) col = n === 0 ? (a.hasBoundary ? skip : null) : n === 1 ? cov : ovl;
      else if (n) { col = off; alpha = 220; }
      if (!col) continue;
      const o = (row + i) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = alpha;
    }
  }
  ctx.putImageData(im, 0, 0);
  state.img = { a, key, canvas: c };
  return c;
}

function niceLength(maxFt) {
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 2640, 5280];
  return steps.filter(s => s <= maxFt).pop() || 50;
}

function renderMap() {
  const cv = $('map'), wrap = cv.parentElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const a = state.analysis;
  $('mapEmpty').hidden = !!a;
  cv.classList.toggle('drawing', !!state.draw);
  if (!a) { state.view = null; return; }

  const g = a.grid, ww = g.W * g.cellM, hh = g.H * g.cellM, pad = 30;
  const k = Math.min((w - 2 * pad) / ww, (h - 2 * pad) / hh);
  const ox = (w - ww * k) / 2, oy = (h - hh * k) / 2;
  const sx = x => ox + (x - g.minX) * k, sy = y => oy + (g.minY + hh - y) * k;
  state.view = { sx, sy, inv: (px, py) => [g.minX + (px - ox) / k, g.minY + hh - (py - oy) / k] };

  const ink = cssVar('--ink'), muted = cssVar('--muted'), surface = cssVar('--surface');

  // field ground
  if (a.hasBoundary) {
    ctx.fillStyle = cssVar('--field');
    ctx.beginPath();
    a.polys.forEach(p => p.forEach(r => r.forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)))));
    ctx.fill('evenodd');
  }
  ctx.imageSmoothingEnabled = k < 2.5;
  ctx.drawImage(coverageImage(a), ox, oy, ww * k, hh * k);

  if ($('showTrack').checked) {
    ctx.lineWidth = 1; ctx.lineJoin = 'round';
    let prev = null;
    for (const [x, y, on, fl] of a.track) {
      if (prev && prev[3] === fl) {
        ctx.strokeStyle = on && prev[2] ? ink : muted;
        ctx.globalAlpha = on && prev[2] ? 0.55 : 0.35;
        ctx.setLineDash(on && prev[2] ? [] : [3, 3]);
        ctx.beginPath(); ctx.moveTo(sx(prev[0]), sy(prev[1])); ctx.lineTo(sx(x), sy(y)); ctx.stroke();
      }
      prev = [x, y, on, fl];
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }

  if (a.hasBoundary) {
    ctx.strokeStyle = cssVar('--boundary'); ctx.lineWidth = 2;
    a.polys.forEach(p => p.forEach(r => {
      ctx.beginPath(); r.forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))); ctx.closePath(); ctx.stroke();
    }));
  }

  // numbered re-spray markers
  ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  bigGaps(a).forEach((gp, i) => {
    const x = sx(gp.x), y = sy(gp.y);
    ctx.fillStyle = surface; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = cssVar('--skip'); ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = ink; ctx.fillText(String(i + 1), x, y + 0.5);
  });

  // scale bar and north arrow
  const ftPerPx = 1 / (k * M_PER_FT);
  const len = niceLength(ftPerPx * w * 0.25);
  const px = len / ftPerPx, bx = 14, by = h - 14;
  ctx.strokeStyle = ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + px, by); ctx.lineTo(bx + px, by - 5); ctx.stroke();
  ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = '500 11px "IBM Plex Mono", monospace';
  ctx.fillText(len >= 2640 ? `${len / 5280} mi` : `${len} ft`, bx + px + 6, by + 1);
  ctx.textAlign = 'center';
  ctx.beginPath(); ctx.moveTo(w - 20, 12); ctx.lineTo(w - 26, 28); ctx.lineTo(w - 20, 24); ctx.lineTo(w - 14, 28); ctx.closePath(); ctx.fill();
  ctx.textBaseline = 'top'; ctx.fillText('N', w - 20, 31);

  // boundary being drawn
  if (state.draw) {
    const pts = state.draw.pts;
    ctx.strokeStyle = cssVar('--accent'); ctx.fillStyle = cssVar('--accent'); ctx.lineWidth = 2;
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)));
    if (pts.length > 2) ctx.closePath();
    ctx.stroke();
    pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(sx(x), sy(y), 4, 0, Math.PI * 2); ctx.fill(); });
  }
}

const bigGaps = a => a.gaps.filter(g => g.areaM2 >= 20).slice(0, 9);

function probe(e) {
  const a = state.analysis, v = state.view;
  if (!a || !v) return;
  const r = $('map').getBoundingClientRect();
  const [x, y] = v.inv(e.clientX - r.left, e.clientY - r.top);
  const g = a.grid;
  const i = Math.floor((x - g.minX) / g.cellM), j = Math.floor((y - g.minY) / g.cellM);
  if (i < 0 || j < 0 || i >= g.W || j >= g.H) { $('probe').textContent = ''; return; }
  const n = g.count[j * g.W + i], f = g.inField[j * g.W + i];
  const [lat, lon] = a.proj.toLatLon(x, y);
  const what = n === 0 ? (f || !a.hasBoundary ? 'not sprayed' : 'outside field') : `${n} pass${n > 1 ? 'es' : ''}${a.hasBoundary && !f ? ', off target' : ''}`;
  $('probe').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)} · ${what}`;
}

// ---------------------------------------------------------------- panels

function stat(k, v, unit, d, tone) {
  return `<div class="stat"${tone ? ` data-tone="${tone}"` : ''}><span class="k">${k}</span><span class="v">${v}${unit ? `<small>${unit}</small>` : ''}</span><span class="d">${d}</span></div>`;
}

function renderStats() {
  const s = state.rec.summary, a = state.analysis;
  if (!s || !a) {
    $('stats').innerHTML = ['Field area', 'Coverage', 'Skipped', 'Overlap', 'Off target', 'Applied', 'Actual rate', 'Spray time']
      .map(k => stat(k, '—', '', 'Needs a flight log')).join('');
    return;
  }
  const nb = !s.hasBoundary;
  const needB = 'Add a field boundary';
  const cov = s.coveragePct;
  const gal = volumeGal(state.rec), ac = acresTreated(state.rec);
  const gpa = gal / ac, tgt = Number(state.rec.equipment.targetGpa);
  const dev = Number.isFinite(gpa) && tgt > 0 ? (gpa / tgt - 1) * 100 : NaN;
  const patches = bigGaps(a).length;
  $('stats').innerHTML = [
    stat('Field area', nb ? '—' : fmt(s.fieldAcres, 2), nb ? '' : 'ac', nb ? 'No boundary: draw or import one to find skips' : `${state.rec.job.field || 'Boundary'}`),
    stat('Coverage', nb ? '—' : fmt(cov, 1), nb ? '' : '%', nb ? needB : `${fmt(s.acresTreated, 2)} ac sprayed in field`, nb ? '' : cov >= 98 ? 'ok' : cov >= 93 ? 'warn' : 'bad'),
    stat('Skipped', nb ? '—' : fmt(s.skipAcres, 2), nb ? '' : 'ac', nb ? needB : patches ? `${patches} patch${patches > 1 ? 'es' : ''} to check` : 'No patches over 0.005 ac', nb ? '' : s.skipAcres > 0.25 ? 'warn' : 'ok'),
    stat('Overlap', nb ? fmt(s.overlapAcres, 2) : fmt(s.overlapAcres, 2), 'ac', nb ? 'Sprayed twice or more' : `${fmt(a.stats.overlapPct, 1)}% of the field got 2+ passes`),
    stat('Off target', nb ? '—' : fmt(s.offTargetAcres, 2), nb ? '' : 'ac', nb ? needB : 'Sprayed outside the boundary', nb ? '' : s.offTargetAcres > 0.1 ? 'warn' : ''),
    stat('Applied', fmt(gal, 1), Number.isFinite(gal) ? 'gal' : '', state.rec.volumeGalOverride ? 'Entered by hand' : s.volumeGal == null ? 'No flow data in the log: enter gallons' : 'Measured from pump flow'),
    stat('Actual rate', fmt(gpa, 2), Number.isFinite(gpa) ? 'gal/ac' : '', tgt > 0 ? `Target ${fmt(tgt, 1)}${Number.isFinite(dev) ? ` (${dev >= 0 ? '+' : ''}${fmt(dev, 0)}%)` : ''}` : 'Set a target spray volume', Number.isFinite(dev) ? (Math.abs(dev) > 10 ? 'warn' : 'ok') : ''),
    stat('Spray time', fmt(s.sprayMinutes, 0), 'min', `${s.flights} flight${s.flights !== 1 ? 's' : ''} · ${hhmm(new Date(s.start))}–${hhmm(new Date(s.end))}`),
  ].join('');
}

function renderGaps() {
  const a = state.analysis;
  const el = $('gaps');
  if (!a) { el.innerHTML = '<li class="none">Import a flight log to find unsprayed patches.</li>'; return; }
  if (!a.hasBoundary) { el.innerHTML = '<li class="none">Add a field boundary to find unsprayed patches.</li>'; return; }
  const gs = bigGaps(a);
  if (!gs.length) { el.innerHTML = '<li class="none">No unsprayed patches larger than 0.005 ac.</li>'; return; }
  el.innerHTML = gs.map(g => {
    const c = `${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}`;
    return `<li><span><span class="ac">${fmt(acres(g.areaM2), 3)} ac</span> <span class="coord">${c}</span></span><button type="button" class="btn copy" data-copy="${c}">Copy</button></li>`;
  }).join('');
}

function renderFlights() {
  const a = state.analysis;
  if (!a) { $('flights').innerHTML = '<tr><td colspan="4">—</td></tr>'; return; }
  $('flights').innerHTML = a.flights.map(f => {
    const span = f.sprayStart != null ? `${hhmm(new Date(f.sprayStart))}–${hhmm(new Date(f.sprayEnd))}` : 'No spraying';
    const mins = f.sprayStart != null ? (f.sprayEnd - f.sprayStart) / 60000 : 0;
    return `<tr><td class="mono">${esc(f.id)}</td><td class="mono">${span}</td><td class="num">${fmt(mins, 1)}</td><td class="num">${a.hasFlow ? fmt(f.volumeL / L_PER_GAL, 1) : '—'}</td></tr>`;
  }).join('');
}

function renderNotices() {
  $('notices').innerHTML = state.notices.map(n => `<li class="${n.err ? 'err' : ''}">${esc(n.text)}</li>`).join('');
  const files = state.rec.sourceFiles || [];
  $('files').textContent = files.length ? `Source: ${files.join(', ')}` : '';
  $('btnDraw').disabled = !state.analysis;
  $('btnDraw').textContent = state.boundary.length ? 'Redraw boundary' : 'Draw boundary';
}

// ---------------------------------------------------------------- form

function fillForm() {
  document.querySelectorAll('#form [data-path]').forEach(el => { el.value = getPath(state.rec, el.dataset.path) ?? ''; });
  $('swath').value = state.rec.equipment.swathFt;
  const s = state.rec.summary;
  $('f_acres').placeholder = s ? fmt(s.acresTreated, 2) + ' from log' : '';
  $('f_gal').placeholder = s?.volumeGal != null ? fmt(s.volumeGal, 1) + ' from log' : '';
  renderProducts();
}

function renderProducts() {
  const unitOpts = sel => UNITS.map(u => `<option value="${u}"${u === sel ? ' selected' : ''}>${u}/ac</option>`).join('');
  $('products').innerHTML = state.rec.products.map((p, i) => `
    <div class="product" data-i="${i}">
      <div class="row">
        <label>Product name <input id="p${i}_name" data-prod="name" value="${esc(p.name)}"></label>
        <label>EPA Reg. No. <input id="p${i}_epa" data-prod="epa" value="${esc(p.epa)}" placeholder="e.g. 524-475"></label>
      </div>
      <div class="row3">
        <label>Label rate <input id="p${i}_rate" data-prod="rate" type="number" step="any" min="0" inputmode="decimal" value="${esc(p.rate)}"></label>
        <label>Unit <select id="p${i}_unit" data-prod="unit">${unitOpts(p.unit)}</select></label>
        <label>REI, hours <input id="p${i}_rei" data-prod="rei" type="number" step="any" min="0" inputmode="decimal" value="${esc(p.rei)}"></label>
        <label>PHI, days <input id="p${i}_phi" data-prod="phi" type="number" step="1" min="0" inputmode="numeric" value="${esc(p.phi)}"></label>
      </div>
      <div class="calc"><span>Applied <b data-calc="total">—</b></span><span>Actual <b data-calc="rate">—</b></span>${state.rec.products.length > 1 ? `<button type="button" class="remove" data-remove="${i}">Remove</button>` : ''}</div>
    </div>`).join('');
  refreshDerived();
}

function refreshDerived() {
  const r = state.rec;
  document.querySelectorAll('.product').forEach(el => {
    const p = r.products[+el.dataset.i];
    const t = p && productTotals(p, r);
    el.querySelector('[data-calc="total"]').textContent = t ? `${fmt(t.total, 1)} ${t.unit}` : '—';
    el.querySelector('[data-calc="rate"]').textContent = t && Number.isFinite(t.actualRate) ? `${fmt(t.actualRate, 2)} ${t.unit}/ac` : '—';
    el.querySelector('[data-calc="total"]').title = t ? (t.method === 'measured' ? 'From gallons sprayed × tank-mix concentration' : 'Label rate × acres treated (no measured volume)') : '';
  });

  const re = reentryTime(r), hv = harvestDate(r);
  const maxOf = k => Math.max(...r.products.map(p => Number(p[k])).filter(Number.isFinite));
  $('intervals').innerHTML = `
    <div class="interval${re ? '' : ' na'}"><span class="k">Re-entry allowed</span><span class="v">${re ? fmtDateTime(re) : 'Enter REI and times'}</span>${re ? `<span class="d hint">${maxOf('rei')} h restricted-entry interval</span>` : ''}</div>
    <div class="interval${hv ? '' : ' na'}"><span class="k">Harvest not before</span><span class="v">${hv ? fmtDate(hv) : 'Enter PHI and date'}</span>${hv ? `<span class="d hint">${maxOf('phi')} day pre-harvest interval</span>` : ''}</div>`;

  const c = complianceCheck(r);
  const fedMissing = c.missing.filter(m => m.scope === 'federal').length;
  const chip = $('complianceChip');
  chip.className = 'chip ' + (c.complete ? 'ok' : fedMissing ? 'bad' : 'warn');
  chip.textContent = c.complete ? 'Complete' : fedMissing ? `${fedMissing} required item${fedMissing > 1 ? 's' : ''} missing` : `${c.missing.length} state item${c.missing.length > 1 ? 's' : ''} missing`;
  $('checklist').innerHTML = c.items.map(i => `<li class="${i.ok ? '' : 'miss'}">${i.label}${i.scope === 'state' ? ' <small>state</small>' : ''}</li>`).join('');

  $('jobTitle').textContent = r.job.field ? `${r.job.field}${r.job.date ? ' · ' + fmtDate(new Date(r.job.date + 'T00:00')) : ''}` : 'New application record';
  renderStats();
}

function markDirty() {
  state.dirty = true;
  $('saveState').textContent = 'Unsaved changes';
}

// ---------------------------------------------------------------- records list

async function refreshList() {
  state.records = await listRecords();
  $('recCount').textContent = state.records.length;
  $('recEmpty').hidden = state.records.length > 0;
  $('recList').innerHTML = state.records.map(r => {
    const c = complianceCheck(r);
    const fed = c.missing.filter(m => m.scope === 'federal').length;
    const ac = acresTreated(r);
    return `<li><button type="button" data-id="${r.id}" aria-current="${r.id === state.rec.id}">
      <span class="r-title">${esc(r.job.field || 'Untitled field')}${r.job.farm ? ` <span class="r-meta">${esc(r.job.farm)}</span>` : ''}</span>
      <span class="r-meta">${r.job.date || 'No date'} · ${fmt(ac, 1)} ac · ${r.products.filter(p => p.name).length} product${r.products.filter(p => p.name).length !== 1 ? 's' : ''}</span>
      <span class="chip ${c.complete ? 'ok' : fed ? 'bad' : 'warn'}">${c.complete ? 'Complete' : fed ? `${fed} missing` : 'State items missing'}</span>
    </button></li>`;
  }).join('');
  $('btnDelete').hidden = !state.records.some(r => r.id === state.rec.id);
}

function loadRecord(rec) {
  state.rec = structuredClone(rec);
  state.points = rec.log?.points ? unpackPoints(rec.log.points) : [];
  state.boundary = rec.log?.boundary || [];
  state.notices = [];
  state.draw = null; $('drawBar').hidden = true;
  analyze();
  state.dirty = false;
  $('saveState').textContent = `Saved ${fmtDateTime(new Date(rec.updatedAt))}`;
  renderAll();
}

function newRecord(seed) {
  const r = emptyRecord();
  if (seed) {
    // keep the applicator and drone from the last job: they rarely change between fields
    r.applicator = { ...seed.applicator };
    r.equipment = { ...seed.equipment };
  }
  state.rec = r; state.points = []; state.boundary = []; state.notices = []; state.draw = null;
  $('drawBar').hidden = true;
  analyze();
  state.dirty = false; $('saveState').textContent = '';
  renderAll();
}

function loadSample() {
  const j = sampleJob();
  const r = emptyRecord();
  Object.assign(r.job, j.record.job);
  r.applicator = { ...j.record.applicator };
  r.equipment = { ...j.record.equipment };
  r.products = j.record.products.map(p => ({ ...p }));
  r.conditions = { ...j.record.conditions };
  r.notes = j.record.notes;
  r.sourceFiles = [j.fileName, 'north-40-boundary.geojson'];
  state.rec = r;
  state.points = parseFile(j.fileName, j.csv).points;
  state.boundary = j.boundary;
  state.notices = [{ text: 'Sample job loaded: a simulated 40-acre fungicide application with a clogged nozzle on one pass and GPS drift on another. Every name and number here is an example.' }];
  syncLog();
  analyze();
  setTimesFromLog();
  state.dirty = true; $('saveState').textContent = 'Example, not saved';
  renderAll();
}

function renderAll() {
  fillForm();
  renderNotices();
  renderGaps();
  renderFlights();
  renderMap();
  refreshList();
}

// ---------------------------------------------------------------- export & print

function exportCSV() {
  const saved = state.records;
  const list = saved.length ? saved : state.rec.summary ? [state.rec] : [];
  const csv = recordsToCSV(list);
  $('exportText').value = csv;
  $('exportSummary').textContent = list.length
    ? `${list.length} record${list.length > 1 ? 's' : ''}, one row per product. Paste into a spreadsheet or keep the file with your records.${saved.length ? '' : ' Includes the current, unsaved record.'}`
    : 'No records yet. Save a record first.';
  $('exportDownload').hidden = embedded;
  $('exportState').textContent = '';
  $('exportDialog').showModal();
}

async function copyText(text, el, textarea) {
  try { await navigator.clipboard.writeText(text); if (el) el.textContent = 'Copied'; }
  catch { if (textarea) { textarea.focus(); textarea.select(); } if (el) el.textContent = 'Press Ctrl+C (⌘C) to copy the selected text'; }
}

function downloadCSV() {
  const blob = new Blob([$('exportText').value], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spray-records-${isoDate(new Date())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function buildReport() {
  const r = state.rec, s = r.summary || {};
  const kv = (k, v) => `<div><span>${k}</span>${esc(v || '—')}</div>`;
  const re = reentryTime(r), hv = harvestDate(r);
  const gal = volumeGal(r), ac = acresTreated(r);
  const img = state.analysis ? $('map').toDataURL('image/png') : null;
  const prods = r.products.filter(p => p.name);
  $('report').innerHTML = `
    <h1>Pesticide Application Record</h1>
    <p>${esc(r.applicator.company)}</p>
    <h2>Application</h2>
    <div class="kv">
      ${kv('Farm or customer', r.job.farm)}${kv('Field', r.job.field)}${kv('Crop or site', r.job.crop)}
      ${kv('Date', r.job.date)}${kv('Start – end', r.job.start && `${r.job.start} – ${r.job.end}`)}${kv('Target pest', r.job.pest)}
      ${kv('Location (centre)', s.lat != null ? `${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}` : '')}${kv('Acres treated', fmt(ac, 2))}${kv('Field acres', s.hasBoundary ? fmt(s.fieldAcres, 2) : '')}
      ${kv('Spray volume', Number.isFinite(gal) ? `${fmt(gal, 1)} gal (${fmt(gal / ac, 2)} gal/ac)` : '')}${kv('Coverage', s.coveragePct != null ? `${fmt(s.coveragePct, 1)}% · skipped ${fmt(s.skipAcres, 2)} ac` : '')}${kv('Off target', s.hasBoundary ? `${fmt(s.offTargetAcres, 2)} ac` : '')}
    </div>
    <h2>Products</h2>
    <table><thead><tr><th>Product</th><th>EPA Reg. No.</th><th>Label rate</th><th>Total applied</th><th>Actual rate</th><th>REI</th><th>PHI</th></tr></thead><tbody>
      ${prods.map(p => { const t = productTotals(p, r); return `<tr><td>${esc(p.name)}</td><td>${esc(p.epa)}</td><td>${esc(p.rate)} ${esc(p.unit)}/ac</td><td>${t ? `${fmt(t.total, 1)} ${t.unit}` : '—'}</td><td>${t ? `${fmt(t.actualRate, 2)} ${t.unit}/ac` : '—'}</td><td>${p.rei ? esc(p.rei) + ' h' : '—'}</td><td>${p.phi ? esc(p.phi) + ' d' : '—'}</td></tr>`; }).join('') || '<tr><td colspan="7">—</td></tr>'}
    </tbody></table>
    <div class="kv" style="margin-top:8px">${kv('Re-entry allowed', re ? fmtDateTime(re) : '')}${kv('Harvest not before', hv ? fmtDate(hv) : '')}${kv('Target spray volume', r.equipment.targetGpa ? `${r.equipment.targetGpa} gal/ac` : '')}</div>
    <h2>Applicator, equipment and conditions</h2>
    <div class="kv">
      ${kv('Applicator', r.applicator.name)}${kv('Certification no.', r.applicator.cert)}${kv('Company', r.applicator.company)}
      ${kv('Drone', r.equipment.drone)}${kv('Serial / registration', r.equipment.serial)}${kv('Swath', r.equipment.swathFt ? `${r.equipment.swathFt} ft` : '')}
      ${kv('Wind', r.conditions.wind ? `${r.conditions.wind} mph from ${r.conditions.windDir || '—'}` : '')}${kv('Temperature', r.conditions.temp ? `${r.conditions.temp} °F` : '')}${kv('Humidity', r.conditions.humidity ? `${r.conditions.humidity}%` : '')}
    </div>
    ${img ? `<h2>Coverage map</h2><img src="${img}" alt="Coverage map">` : ''}
    ${r.notes ? `<h2>Notes</h2><p>${esc(r.notes)}</p>` : ''}
    <div class="sig"><div>Applicator signature</div><div>Date</div></div>
    <p style="font-size:8pt;color:#555;margin-top:12px">Generated by SprayLedger from ${esc((r.sourceFiles || []).join(', ') || 'manual entry')}.</p>`;
}

// ---------------------------------------------------------------- events

function confirmClick(btn, label, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; fn(); return; }
  btn.dataset.label = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
}

$('form').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.path) setPath(state.rec, t.dataset.path, t.value);
  else if (t.dataset.prod) state.rec.products[+t.closest('.product').dataset.i][t.dataset.prod] = t.value;
  else return;
  markDirty();
  refreshDerived();
});
$('form').addEventListener('click', e => {
  const rm = e.target.closest('[data-remove]');
  if (rm) { state.rec.products.splice(+rm.dataset.remove, 1); markDirty(); renderProducts(); }
});
$('addProduct').addEventListener('click', () => {
  state.rec.products.push({ name: '', epa: '', rate: '', unit: 'fl oz', rei: '', phi: '' });
  markDirty(); renderProducts();
  $(`p${state.rec.products.length - 1}_name`).focus();
});
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  syncLog();
  await saveRecord(state.rec);
  state.dirty = false;
  $('saveState').textContent = `Saved ${fmtDateTime(new Date())}`;
  await refreshList();
});
$('btnDelete').addEventListener('click', e => confirmClick(e.currentTarget, 'Confirm delete', async () => {
  await deleteRecord(state.rec.id);
  newRecord(state.rec);
}));
$('btnPrint').hidden = embedded;
$('btnPrint').addEventListener('click', () => { buildReport(); window.print(); });

let swathTimer;
$('swath').addEventListener('input', e => {
  state.rec.equipment.swathFt = e.target.value;
  markDirty();
  clearTimeout(swathTimer);
  swathTimer = setTimeout(() => { analyze(); renderMap(); renderGaps(); refreshDerived(); }, 250);
});

$('fileInput').addEventListener('change', e => { importFiles(e.target.files); e.target.value = ''; });
const dz = $('dropzone');
addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
addEventListener('dragleave', e => { if (!e.relatedTarget) dz.classList.remove('drag'); });
addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files); });

$('btnNew').addEventListener('click', e => {
  if (state.dirty && state.rec.summary) confirmClick(e.currentTarget, 'Discard changes?', () => newRecord(state.rec));
  else newRecord(state.rec);
});
$('btnSample').addEventListener('click', e => {
  if (state.dirty && state.rec.summary) confirmClick(e.currentTarget, 'Discard changes?', loadSample);
  else loadSample();
});
$('recList').addEventListener('click', e => {
  const b = e.target.closest('[data-id]'); if (!b) return;
  const rec = state.records.find(r => r.id === b.dataset.id);
  if (rec) loadRecord(rec);
});
$('gaps').addEventListener('click', e => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  copyText(b.dataset.copy, b);
  setTimeout(() => { b.textContent = 'Copy'; }, 1500);
});

$('btnExport').addEventListener('click', exportCSV);
$('exportCopy').addEventListener('click', () => copyText($('exportText').value, $('exportState'), $('exportText')));
$('exportDownload').addEventListener('click', downloadCSV);

$('showTrack').addEventListener('change', renderMap);
$('map').addEventListener('pointermove', probe);
$('map').addEventListener('pointerleave', () => { $('probe').textContent = ''; });

// Drawing a boundary on the map
$('btnDraw').addEventListener('click', () => {
  state.draw = { pts: [] };
  $('drawBar').hidden = false; $('drawCount').textContent = '0';
  renderMap();
});
$('map').addEventListener('click', e => {
  if (!state.draw || !state.view) return;
  const r = $('map').getBoundingClientRect();
  state.draw.pts.push(state.view.inv(e.clientX - r.left, e.clientY - r.top));
  $('drawCount').textContent = state.draw.pts.length;
  renderMap();
});
$('drawUndo').addEventListener('click', () => { state.draw?.pts.pop(); $('drawCount').textContent = state.draw?.pts.length ?? 0; renderMap(); });
$('drawCancel').addEventListener('click', () => { state.draw = null; $('drawBar').hidden = true; renderMap(); });
$('drawDone').addEventListener('click', () => {
  const pts = state.draw?.pts || [];
  if (pts.length < 3) { $('drawCount').textContent = `${pts.length} (need at least 3)`; return; }
  const proj = state.analysis.proj;
  state.boundary = [[pts.map(([x, y]) => proj.toLatLon(x, y))]];
  state.draw = null; $('drawBar').hidden = true;
  state.notices = state.notices.filter(n => !/boundary/i.test(n.text));
  syncLog(); analyze(); markDirty(); renderAll();
});

new ResizeObserver(() => renderMap()).observe($('map').parentElement);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { state.img = null; renderMap(); });
new MutationObserver(() => { state.img = null; renderMap(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------------------------------------------------------------- start

(async () => {
  const ok = await persistent();
  const note = $('storageNote');
  note.hidden = false;
  note.textContent = ok ? 'Records are stored in this browser on this device. Export regularly to keep a copy.' : 'This browser is not keeping data, so saved records last only until the tab closes. Export to keep them.';
  await refreshList();
  if (state.records.length) loadRecord(state.records[0]);
  else loadSample();
})();
