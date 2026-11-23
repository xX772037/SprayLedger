import { parseFile, LOG_PROFILES } from './parse.js';
import { computeCoverage, acres } from './coverage.js';
import { M_PER_FT, L_PER_GAL, makeProjection, boundaryArea, M2_PER_ACRE } from './geo.js';
import {
  emptyRecord, normalizeRecord, blankProduct, missingRei, UNITS, productTotals, reentryTime, harvestDate, complianceCheck, recordsToCSV, invoiceTotals, fmtMoney, nextInvoiceNumber, invoiceNumberTaken,
  fmt, isoDate, hhmm, fmtDateTime, fmtDate, acresTreated, volumeGal,
} from './records.js';
import { customerReport, stateRecord, invoicePdf, deliverPdf, fileName } from './docs.js';
import { DRONES, PRODUCTS, PRODUCT_GROUPS, droneById, droneName, planJob, applyCatalogProduct, productsFromJobs, litersToGal, lpmToGpm } from './catalog.js';
import { listRecords, saveRecord, deleteRecord, packPoints, unpackPoints, persistent, listEquipment, saveEquipment, deleteEquipment, getSetting, setSetting } from './store.js';
import { applyProfile, applyCatalogEquipment, profileFromEquipment, isGround, sortProfiles } from './equipment.js';
import { sampleJob } from './sample.js';
import { FieldMap } from './map.js';
import { fetchForecast, fetchConditionsAt, assessHour, sprayWindows, downwindEdges, compass16 } from './weather.js';
import { DeviceGPS, SerialGPS, SimulatedRig, LiveSession } from './live.js';
import { SPRAY_LIMITS } from './config.js';
import { PARCEL_SOURCES, PARCEL_ATTRIBUTION, NOT_COVERED_NEARBY, queryParcels, sourcesFor, neighbourZone, classifyParcels, downwindEdgesLL, searchAddress, parcelCenter, legalDescription } from './parcels.js';

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
  fitPending: true,
  live: null,
  wx: null,
  wxLoading: false,
  wxError: null,
  parcelsView: { abort: null, list: [] },
  owners: { key: null },
  equipmentList: [],
  logo: null, // { dataUrl, width, height }: the business logo for the invoice and customer report
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
  const MISMATCH = 'The field boundary does not overlap', DROPPED = 'Some spraying was left out';
  state.notices = state.notices.filter(n => !n.text.startsWith(MISMATCH) && !n.text.startsWith(DROPPED));
  const d = s.dropped;
  if (d && d.gaps + d.jumps > 0) {
    state.notices.push({ text: `${DROPPED} of the coverage map: the log has ${d.gaps + d.jumps} place${d.gaps + d.jumps > 1 ? 's' : ''} where it skips ahead (${d.jumps ? `${d.jumps} GPS jump${d.jumps > 1 ? 's' : ''}` : ''}${d.jumps && d.gaps ? ', ' : ''}${d.gaps ? `${d.gaps} pause${d.gaps > 1 ? 's' : ''} of over 10 seconds` : ''}, ${fmt(d.metres / M_PER_FT, 0)} ft in all). If the map shows red where you sprayed, that's why.` });
  }
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
  let relative = false, naive = false;
  for (const f of files) {
    try {
      const r = parseFile(f.name, await f.text(), { profile: $('logProfile').value });
      if (r.boundary.length) boundaries.push(...r.boundary);
      if (r.points.length) tracks.push({ name: f.name, points: r.points });
      if (r.meta?.relativeTime || r.meta?.timeless) relative = true; // clock times can't be taken from this file
      if (r.meta?.naiveTime) naive = true;
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
    state.rec.logNaive = naive && !relative; // times without a time zone: let the applicator say local or UTC
    state.rec.logTimes = 'local'; // how parse.js read them
    // Drone apps usually write UTC, so times without a zone are taken as UTC; the Spray step lets the
    // applicator switch to local time if their app writes that instead.
    if (state.rec.logNaive) {
      shiftLogTimes('utc');
      state.notices.push({ text: 'The times in this log have no time zone, so they were read as UTC (world time), which most drone apps write. If the start time on step 5 looks wrong by a few hours, change "Times in this log are in" to local time.' });
    }
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

let fmap = null;
function ensureMap() {
  if (fmap) return fmap;
  if (!window.L) { $('mapEmpty').textContent = 'The map library did not load. Reload the page to try again.'; return null; }
  fmap = new FieldMap($('map'), {
    onClick: ll => {
      if (!state.draw) return;
      state.draw.pts.push(ll);
      $('drawCount').textContent = state.draw.pts.length;
      fmap.setDraft(state.draw.pts);
    },
    onMove: probe,
    onTileStatus: s => showTileNote(s === 'blocked'),
    onMoveEnd: scheduleViewParcels,
    onSearch: findAddress,
  });
  return fmap;
}

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function rgb(hex) {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

// Coverage raster, north up: green sprayed, red not sprayed (inside the field), amber twice, purple off target.
function coverageImage(a) {
  if (state.img?.a === a) return state.img.canvas;
  const { W, H, count, inField } = a.grid;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const im = ctx.createImageData(W, H);
  const cov = rgb('#2fb350'), ovl = rgb('#f0a020'), skip = rgb('#e03030'), off = rgb('#9b5cf0');
  const d = im.data;
  for (let j = 0; j < H; j++) {
    const row = (H - 1 - j) * W;
    for (let i = 0; i < W; i++) {
      const cidx = j * W + i, n = count[cidx], f = a.hasBoundary ? inField[cidx] : 1;
      let col = null;
      if (f) col = n === 0 ? (a.hasBoundary ? skip : null) : n === 1 ? cov : ovl;
      else if (n) col = off;
      if (!col) continue;
      const o = (row + i) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
  }
  ctx.putImageData(im, 0, 0);
  state.img = { a, canvas: c };
  return c;
}

function renderMap() {
  const m = ensureMap();
  const a = state.analysis;
  $('mapEmpty').hidden = !!a || !!state.live;
  if (!m) return;
  $('map').classList.toggle('drawing', !!state.draw);
  m.setAnalysis(a, a ? coverageImage(a) : null, { showTrack: $('showTrack').checked, fit: state.fitPending && !state.live });
  m.setPlanBoundary(!a && state.boundary.length ? state.boundary : null, { fit: state.fitPending && !state.live });
  if (a || state.boundary.length) state.fitPending = false;
  $('mapEmpty').hidden = !!a || !!state.live || state.boundary.length > 0;
  renderDownwind();
}

const bigGaps = a => a.gaps.filter(g => g.areaM2 >= 20).slice(0, 9);

function probe([lat, lon]) {
  const a = state.analysis;
  if (!a) return;
  const [x, y] = a.proj.toXY(lat, lon);
  const g = a.grid;
  const i = Math.floor((x - g.minX) / g.cellM), j = Math.floor((y - g.minY) / g.cellM);
  if (i < 0 || j < 0 || i >= g.W || j >= g.H) { $('probe').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`; return; }
  const n = g.count[j * g.W + i], f = g.inField[j * g.W + i];
  const what = n === 0 ? (f || !a.hasBoundary ? 'not sprayed' : 'outside field') : `${n} pass${n > 1 ? 'es' : ''}${a.hasBoundary && !f ? ', off target' : ''}`;
  $('probe').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)} · ${what}`;
}

// ---------------------------------------------------------------- weather

function wxLocation() {
  if (state.analysis) return [state.analysis.proj.lat0, state.analysis.proj.lon0];
  if (state.boundary.length) {
    const r = state.boundary[0][0];
    return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
  }
  const f = state.live?.session.last;
  return f ? [f.lat, f.lon] : null;
}

const wxNow = () => {
  const hs = state.wx?.hours; if (!hs?.length) return null;
  const now = Date.now();
  return hs.find(h => now >= h.t && now < h.t + 3600_000) || hs.find(h => h.t > now) || hs[hs.length - 1];
};

async function loadWeather(force = false) {
  const loc = wxLocation();
  if (!loc) { renderWeather(); return; }
  const w = state.wx;
  if (!force && w && !w.example && Math.abs(w.lat - loc[0]) < 0.02 && Math.abs(w.lon - loc[1]) < 0.02 && Date.now() - w.fetchedAt < 20 * 60_000) { renderWeather(); return; }
  state.wxLoading = true; state.wxError = null; renderWeather();
  try {
    state.wx = { lat: loc[0], lon: loc[1], hours: await fetchForecast(loc[0], loc[1]), fetchedAt: Date.now() };
  } catch (e) {
    state.wxError = e.message;
  }
  state.wxLoading = false;
  renderWeather(); renderDownwind(); lookupOwners();
}

/** Clearly labelled example data for when the weather service can't be reached (e.g. in a preview). */
function exampleWeather() {
  const loc = wxLocation() || [41.92, -93.58];
  const start = new Date(); start.setMinutes(0, 0, 0);
  const hours = [];
  for (let k = 0; k < 36; k++) {
    const t = start.getTime() + k * 3600_000, hr = new Date(t).getHours();
    const day = Math.sin(((hr - 9) / 24) * 2 * Math.PI);           // peaks mid-afternoon
    const h = {
      t, temp: 66 + 12 * day, rh: 68 - 22 * day, dir: 215 + 20 * Math.sin(k / 5),
      wind: Math.max(1, 6.5 + 5 * day), t80: 66 + 12 * day + (day < -0.3 ? 4 : -2), precip: 0,
      rainSoon: hr >= 16 && hr <= 18 ? 55 : 5,
    };
    h.gust = h.wind * 1.5;
    hours.push({ ...h, ...assessHour(h) });
  }
  state.wx = { lat: loc[0], lon: loc[1], hours, fetchedAt: Date.now(), example: true };
  state.wxError = null;
  renderWeather(); renderDownwind();
}

const arrowSvg = (deg, cls = 'arr') => `<svg class="${cls}" viewBox="0 0 12 12" style="transform:rotate(${deg}deg)" aria-hidden="true"><path d="M6 1 L10 10 L6 8 L2 10 Z" fill="currentColor"/></svg>`;
const hourLabel = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' AM', 'a').replace(' PM', 'p');
const dayTime = t => {
  const d = new Date(t), today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const day = d.toDateString() === today.toDateString() ? 'Today' : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${day} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

function renderWeather() {
  const body = $('wxBody'), chip = $('wxChip'), where = $('wxWhere');
  $('wxRefresh').hidden = !wxLocation();
  if (state.wxLoading) { body.innerHTML = '<p class="sub">Getting the forecast for this field…</p>'; chip.textContent = ''; return; }
  if (state.wxError) {
    chip.textContent = ''; where.textContent = '';
    body.innerHTML = `<p class="sub">${esc(state.wxError)}</p><div><button type="button" class="btn" id="wxExample">Show an example forecast</button></div>`;
    $('wxExample').addEventListener('click', exampleWeather);
    return;
  }
  const now = wxNow();
  if (!now) { chip.textContent = ''; where.textContent = ''; body.innerHTML = '<p class="sub">Choose the field first (step 1). The forecast is for that spot.</p>'; return; }

  const label = { go: 'Yes, good to spray', caution: 'Spray with care', no: 'No, don’t spray now' }[now.status];
  chip.className = `chip ${now.status}`; chip.textContent = label;
  where.textContent = state.wx.example
    ? 'Example data, not real weather'
    : `${state.wx.lat.toFixed(4)}, ${state.wx.lon.toFixed(4)} · Open-Meteo, ${new Date(state.wx.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const toward = (now.dir + 180) % 360;
  const upcoming = state.wx.hours.filter(h => h.t + 3600_000 > Date.now()).slice(0, 24);
  const wins = sprayWindows(state.wx.hours, Date.now()).slice(0, 3);
  const dt = now.deltaT;
  body.innerHTML = `
    <div class="wx-now">
      <div class="wind-dial">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="2"/>
          <text x="32" y="11" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor">N</text>
          <g transform="rotate(${toward} 32 32)"><path d="M32 12 L40 36 L32 31 L24 36 Z" fill="#ffb000" stroke="currentColor" stroke-opacity=".4"/><line x1="32" y1="31" x2="32" y2="52" stroke="#ffb000" stroke-width="3"/></g>
        </svg>
        <div>
          <div class="big">${Math.round(now.wind)}<small>mph from ${compass16(now.dir)}</small></div>
          <div class="sub2">Gusts ${Math.round(now.gust)} mph · drift goes ${compass16(toward)}</div>
        </div>
      </div>
      <div>
        <dl class="wx-facts">
          <div><dt>Temp</dt><dd>${Math.round(now.temp)}°F</dd></div>
          <div><dt>Humidity</dt><dd>${Math.round(now.rh)}%</dd></div>
          <div><dt>Delta T</dt><dd>${dt.toFixed(1)}°F</dd></div>
          <div><dt>Rain, next 2 h</dt><dd>${Math.round(now.rainSoon)}%</dd></div>
          <div><dt>Inversion</dt><dd>${now.inversion ? 'Likely' : now.t80 == null ? 'Unknown' : 'Unlikely'}</dd></div>
        </dl>
        <ul class="wx-reasons">${now.reasons.length ? now.reasons.map(r => `<li data-level="${r.level}">${esc(r.text)}</li>`).join('') : '<li data-level="0">Wind, Delta T, inversion risk and rain are all within the limits.</li>'}</ul>
      </div>
    </div>
    <p class="wx-key"><span><i style="background:#17703f"></i>Good</span><span><i style="background:#a86400"></i>Careful</span><span><i style="background:#b02525"></i>Don't spray</span><span>Number = wind in mph · arrow = where drift goes</span></p>
    <div class="hours" role="list" aria-label="Next 24 hours">${upcoming.map(h => `
      <div class="hour${h === now ? ' now' : ''}" role="listitem" title="${esc(`${dayTime(h.t)}: ${Math.round(h.wind)} mph from ${compass16(h.dir)}, gusts ${Math.round(h.gust)}. ${h.reasons.map(r => r.text).join('. ') || 'Within limits.'}`)}">
        <span class="bar" data-s="${h.status}">${Math.round(h.wind)}</span>${arrowSvg((h.dir + 180) % 360)}<span class="t">${hourLabel(h.t)}</span>
      </div>`).join('')}
    </div>
    <p class="wx-windows">${wins.length ? `Best times to spray: ${wins.map(w => `<b>${dayTime(w.start)} to ${new Date(w.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</b>`).join(', ')}` : 'No good time to spray in the forecast.'}</p>
    ${state.boundary.length ? `<p class="wx-drift">Drift goes toward the <b>${compass16(toward)}</b>. The field edges on that side are marked in gold on the map. Keep a buffer there and check what's downwind: sensitive crops, homes, water, bee yards. Start on the downwind side and work into the wind.</p>` : ''}
    <p class="wx-note">Good means wind ${SPRAY_LIMITS.windMinMph}–${SPRAY_LIMITS.windMaxMph} mph, gusts under ${SPRAY_LIMITS.gustMaxMph} mph, no inversion, no rain coming and air not too dry. Forecast wind is at 33 ft. The product label is the law: if it says less wind, go by the label.</p>`;
}

function renderLegend(hasDownwind) {
  const a = state.analysis;
  const show = { cov: !!a, skip: !!a?.hasBoundary, ovl: !!a, off: !!a?.hasBoundary, dw: hasDownwind, nb: !!state.owners?.neighbours?.length };
  document.querySelectorAll('.legend [data-key]').forEach(li => { li.hidden = !show[li.dataset.key]; });
}

function renderDownwind() {
  if (!fmap) return;
  const a = state.analysis, now = wxNow();
  if (!now || now.wind < 1 || !state.boundary.length) { fmap.setDownwind([]); renderLegend(false); return; }
  renderLegend(true);
  const label = `Downwind edge: drift goes ${compass16((now.dir + 180) % 360)} today`;
  if (a?.hasBoundary) {
    const { edges } = downwindEdges(a.polys, now.dir);
    fmap.setDownwind(edges.map(e => e.map(([x, y]) => a.proj.toLatLon(x, y))), label);
  } else {
    fmap.setDownwind(downwindEdgesLL(state.boundary, now.dir), label);
  }
}

// ---------------------------------------------------------------- parcels and owners

const COVERED = PARCEL_SOURCES.map(s => s.county).join(', ');
const feetOrMiles = m => (m / M_PER_FT < 1000 ? `${fmt(m / M_PER_FT, 0)} ft` : `${fmt(m / 1609.344, 2)} mi`);
const distLabel = () => $('nbDist').selectedOptions[0].textContent;
let parcelTimer;

function scheduleViewParcels() { clearTimeout(parcelTimer); parcelTimer = setTimeout(loadViewParcels, 350); }
function setParcelHint(t) { $('parcelHint').textContent = t; }

async function loadViewParcels() {
  if (!fmap) return;
  const pv = state.parcelsView;
  pv.abort?.abort();
  const on = $('showParcels').checked;
  if (!on || fmap.zoom() < 14) {
    pv.list = []; fmap.setParcels([]);
    setParcelHint(on ? 'Zoom in to see parcel lines' : '');
    return;
  }
  const box = fmap.viewBox();
  if (!sourcesFor(box).length) { pv.list = []; fmap.setParcels([]); setParcelHint('No county parcel data for this area'); return; }
  const ctl = new AbortController(); pv.abort = ctl;
  setParcelHint('Loading parcels…');
  try {
    const r = await queryParcels({ bbox: box }, { signal: ctl.signal });
    pv.list = r.parcels;
    fmap.setParcels(r.parcels, { interactive: !state.draw, onPick: showParcel, attribution: PARCEL_ATTRIBUTION });
    if (r.errors.length && !r.parcels.length) setParcelHint(`Parcel data unavailable${embedded ? ': this preview blocks outside data' : ''}`);
    else if (r.errors.length) setParcelHint(`No parcel data from ${r.errors.map(e => e.county).join(', ')} right now`);
    else setParcelHint(`${r.parcels.length} parcels · tap one for the owner`);
  } catch (e) {
    if (e.name !== 'AbortError') setParcelHint('Parcel data unavailable');
  }
}

async function findAddress(text) {
  const box = $('searchResults');
  box.hidden = false;
  $('mapEmpty').hidden = true;
  box.innerHTML = '<p>Looking up the address in county records…</p>';
  let r;
  try { r = await searchAddress(text); }
  catch { r = { query: null, exact: [], near: [], failed: true }; }
  const pickBtn = (p, i) => `<button type="button" class="pick" data-i="${i}"><b>${esc(p.site)}</b><span>${esc(p.county)} County · parcel ${esc(p.parcel || '—')}${p.acres ? ` · ${fmt(p.acres, 1)} acres` : ''}</span></button>`;
  const list = r.exact.length ? r.exact : r.near;
  const close = '<button type="button" class="btn" data-close>Close</button>';
  if (!r.query) box.innerHTML = `<p>Type a house number and road, like <b>41255 277th St</b>, or a latitude and longitude.</p>${close}`;
  else if (!list.length) {
    box.innerHTML = `<p>${r.failed || embedded ? 'County records couldn\'t be reached from here.' : `No address on that road in the county records for ${COVERED} counties.`}</p>${close}`;
  } else {
    box.innerHTML = `<p>${r.exact.length ? (list.length > 1 ? 'Pick one:' : 'Found:') : `No exact match for <b>${esc(text)}</b>. Closest on that road:`}</p>${list.map(pickBtn).join('')}${close}`;
  }
  box.onclick = e => {
    if (e.target.closest('[data-close]')) { box.hidden = true; return; }
    const b = e.target.closest('.pick'); if (!b) return;
    const p = list[+b.dataset.i];
    box.hidden = true;
    fmap.fitTo(p.polygons);
    setTimeout(() => showParcel(p, parcelCenter(p)), 400);
  };
  if (list.length === 1 && r.exact.length) box.querySelector('.pick').click();
}

function showParcel(p, ll) {
  const el = document.createElement('div');
  el.className = 'parcel-pop';
  el.innerHTML = `<b>${esc(p.owner || 'Owner not listed')}</b>
    ${p.site ? `<span>${esc(p.site)}</span>` : ''}
    <span>${esc(p.county)} County · parcel ${esc(p.parcel || '—')}${p.acres ? ` · ${fmt(p.acres, 2)} ac` : ''}</span>
    ${p.legal ? `<span class="muted">${esc(p.legal)}</span>` : ''}
    ${p.mailing ? `<span class="muted">${esc(p.mailing)}</span>` : ''}
    <div class="row"><button type="button" class="primary" data-a="use">Use as field boundary</button>${state.boundary.length ? '<button type="button" data-a="add">Add to field</button>' : ''}</div>`;
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    fmap.closePopup();
    useParcel(p, a === 'add');
  });
  fmap.popup(ll, el);
}

function useParcel(p, add) {
  const j = state.rec.job;
  const uniq = (list, sep) => [...new Set(list.filter(Boolean))].join(sep);
  if (add) {
    state.boundary = [...state.boundary, ...p.polygons];
    j.parcels = uniq([...String(j.parcels || '').split(/,\s*/), p.parcel], ', ');
    j.landowner = uniq([...String(j.landowner || '').split(/;\s*/), p.owner], '; ');
    j.legal = uniq([...String(j.legal || '').split(/;\s*/), legalDescription(p)], '; ');
  } else {
    state.boundary = p.polygons.map(poly => poly.map(r => r.slice()));
    j.parcels = p.parcel; j.landowner = p.owner; j.legal = legalDescription(p);
  }
  state.notices = state.notices.filter(n => !/boundary/i.test(n.text));
  state.notices.push({ text: `Field boundary ${add ? 'extended with' : 'set from'} ${p.county} County parcel ${p.parcel || ''}. County parcel lines follow legal descriptions, so trim it with Redraw boundary if the sprayed area is smaller (waterways, farmstead, road ditches).` });
  state.fitPending = !add;
  state.owners.key = null;
  syncLog(); analyze(); markDirty(); renderAll();
}

async function lookupOwners(force = false) {
  const el = $('owners');
  if (!state.boundary.length) {
    state.owners = { key: null };
    el.innerHTML = `<p class="sub">Set a field boundary to see who owns the field and the land around it. Tap any parcel on the map to see its owner. County records cover ${COVERED} counties.</p>`;
    fmap?.setOwnerHighlights();
    return;
  }
  const now = wxNow();
  const dir = now && now.wind >= 1 ? now.dir : null;
  const dist = Number($('nbDist').value);
  // every corner of the field is in the key, so any change to the field looks up the owners again
  const shape = state.boundary.flat(2).map(([la, lo]) => `${la.toFixed(5)},${lo.toFixed(5)}`).join(';');
  const key = JSON.stringify([shape, dir == null ? null : Math.round(dir / 10), dist]);
  if (!force && key === state.owners.key) return;
  state.owners.key = key;
  const zone = neighbourZone(state.boundary, dir, dist);
  const rings = [...state.boundary.map(p => p[0]), ...zone.rings];
  const pts = rings.flat();
  const box = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
  if (!sourcesFor(box).length) {
    el.innerHTML = `<p class="sub">Owner lookup covers ${COVERED} counties in South Dakota. This field is outside them. Not yet covered nearby: ${NOT_COVERED_NEARBY.join('; ')}.</p>`;
    fmap?.setOwnerHighlights();
    return;
  }
  el.innerHTML = '<p class="sub">Looking up county records…</p>';
  let r;
  try { r = await queryParcels({ rings }); }
  catch (e) { r = { parcels: [], errors: [{ county: '', message: e.message }] }; }
  if (key !== state.owners.key) return; // a newer lookup started
  if (!r.parcels.length && r.errors.length) {
    el.innerHTML = `<p class="sub">County records couldn't be reached${embedded ? ': this preview blocks outside data. It works when the app runs on its own web address' : ` (${esc(r.errors[0].message)})`}.</p>`;
    return;
  }
  const c = classifyParcels(r.parcels, zone);
  Object.assign(state.owners, { field: c.field, neighbours: c.neighbours, zone });
  fmap?.setOwnerHighlights(c.field, c.neighbours);

  const j = state.rec.job;
  if (c.field.length && !j.parcels && !j.landowner) {
    j.parcels = [...new Set(c.field.map(p => p.parcel).filter(Boolean))].join(', ');
    j.landowner = [...new Set(c.field.map(p => p.owner).filter(Boolean))].join('; ');
    if (!j.legal) j.legal = [...new Set(c.field.map(legalDescription).filter(Boolean))].join('; ');
    fillForm(); markDirty();
  }
  const fieldOwners = [...new Set(c.field.map(p => p.owner || 'Owner not listed'))];
  const fieldAc = c.field.reduce((s, p) => s + (p.acres || 0), 0);
  el.innerHTML = `
    ${c.field.length ? `<div class="owner-field"><span class="sub">This field, from county records</span><b>${esc(fieldOwners.join('; '))}</b>
      <span>${c.field.map(p => `${esc(p.county)} ${esc(p.parcel || '?')}`).join(', ')}${fieldAc ? ` · ${fmt(fieldAc, 1)} deeded ac` : ''}</span></div>`
      : '<p class="sub">No parcel centre falls inside this boundary; tap the field on the map to see its parcel.</p>'}
    <p class="sub">${zone.downwind ? `Downwind of the field (drift goes ${compass16(zone.towardDeg)}), within ${distLabel()}:` : `All around the field within ${distLabel()} (load the weather to narrow this to the downwind side):`}</p>
    ${c.neighbours.length ? `<ol class="nb-list">${c.neighbours.slice(0, 25).map(g => `
      <li><div><div class="who">${esc(g.owner || 'Owner not listed')}</div>
        <div class="meta">${g.parcels.length} parcel${g.parcels.length > 1 ? 's' : ''}${g.acres ? ` · ${fmt(g.acres, 1)} ac` : ''} · ${g.distM < 15 ? 'borders the field' : `${feetOrMiles(g.distM)} from the field edge`}</div>
        ${g.mailing ? `<div class="addr">${esc(g.mailing)}</div>` : ''}</div>
        <button type="button" class="btn copy btn-small" data-copy="${esc([g.owner, g.mailing].filter(Boolean).join('\n'))}">Copy</button></li>`).join('')}</ol>`
      : '<p class="sub">No other parcels in that area.</p>'}
    ${r.errors.length ? `<p class="sub">No data from ${esc(r.errors.map(e => e.county).join(', '))} right now.</p>` : ''}
    <p class="sub">Source: county Directors of Equalization, via Planning &amp; Development District III. Public record; it can lag recent sales, so confirm with the county before relying on it.</p>`;
}

// ---------------------------------------------------------------- live tracking

function setTab(name) {
  const live = name === 'live';
  $('tabLog').setAttribute('aria-selected', !live); $('tabLive').setAttribute('aria-selected', live);
  $('paneLog').hidden = live; $('paneLive').hidden = !live;
}

async function startLive() {
  const kind = $('liveSource').value;
  const boomFt = Number($('liveBoom').value) || 90;
  const swathM = boomFt * M_PER_FT;
  let source;
  if (kind === 'device') {
    if (!DeviceGPS.available()) return liveError('This browser has no location access.');
    source = new DeviceGPS();
  } else if (kind === 'serial') {
    if (!SerialGPS.available()) return liveError('USB GPS receivers work in Chrome or Edge on a computer.');
    source = new SerialGPS(Number($('liveBaud').value) || 9600);
  } else {
    if (!state.boundary.length) {
      state.boundary = sampleJob().boundary;
      state.notices = [{ text: 'No field boundary yet, so the simulation drives the sample field.' }];
      state.fitPending = true;
    }
    source = new SimulatedRig({ boundary: state.boundary, swathM, speedMph: 10, speedup: 20 });
  }
  state.rec.equipment.swathFt = boomFt; $('swath').value = boomFt;
  state.points = [];
  state.live = { kind, source, session: new LiveSession({ maxAccuracyM: kind === 'device' ? 20 : 10 }), lastCalc: 0, history: [], swathM };
  try { state.live.wake = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  $('liveStart').hidden = true; $('liveStop').hidden = false; $('liveRun').hidden = false; $('liveSave').disabled = true;
  $('liveSource').disabled = $('liveBoom').disabled = true;
  setBoom(false);
  $('boomSwitch').disabled = kind === 'sim';
  $('boomState').textContent = kind === 'sim' ? 'Simulation' : 'Boom off';
  if (kind === 'sim') $('boomSwitch').querySelector('.boom-hint').textContent = 'The simulated rig switches its own boom';
  if (fmap) fmap.follow = true;
  state.notices = state.notices.filter(n => !/^Live|GPS|Receiver|Waiting/.test(n.text));
  renderNotices(); renderMap();
  source.start(onFix, liveError);
}

function liveError(msg) {
  state.notices = state.notices.filter(n => n.text !== msg);
  state.notices.push({ text: msg, err: !/Waiting/.test(msg) });
  renderNotices();
}

function setBoom(on) {
  if (!state.live) return;
  state.live.session.spray = on;
  $('boomSwitch').setAttribute('aria-pressed', on);
  if (state.live.kind !== 'sim') $('boomState').textContent = on ? 'Spraying' : 'Boom off';
  const f = state.live.session.last;
  if (f) state.live.session.add({ ...f, t: Date.now(), spray: undefined }); // mark the switch where it happened
}

function onFix(fix) {
  const L = state.live; if (!L) return;
  if (fix.spray !== undefined && L.kind === 'sim') $('boomSwitch').setAttribute('aria-pressed', fix.spray);
  const firstFix = !L.session.last;
  L.session.add(fix);
  state.notices = state.notices.filter(n => !/^(Waiting|Receiver has no)/.test(n.text));
  fmap?.setLive(fix, L.swathM);
  $('lvSpeed').textContent = Number.isFinite(fix.speedMps) ? `${fmt(fix.speedMps * 2.23694, 1)} mph` : '—';
  const weak = L.session.rejected;
  $('lvAcc').textContent = (fix.rtk ? `RTK ${fix.rtk}` : `±${fmt(fix.accuracyM / M_PER_FT, 0)} ft`) + (weak ? ` · ${weak} weak fix${weak > 1 ? 'es' : ''} skipped` : '');
  if (firstFix) loadWeather();
  const now = performance.now();
  if (now - L.lastCalc < 1500) return;
  L.lastCalc = now;
  state.points = L.session.points;
  if (state.points.length < 2) return;
  analyze();
  renderMap(); refreshDerived(); renderGaps(); renderFlights(); renderNotices();
  const s = state.analysis.stats, field = acres(s.fieldM2), done = acres(s.coveredM2);
  L.history.push([fix.t, done]);
  while (L.history.length > 2 && fix.t - L.history[0][0] > 5 * 60_000) L.history.shift();
  const [t0, a0] = L.history[0];
  const rate = (done - a0) / ((fix.t - t0) / 60_000); // ac per minute, last 5 min
  const left = state.analysis.hasBoundary ? Math.max(0, field - done) : NaN;
  $('lvSprayed').textContent = `${fmt(acres(s.sprayedM2), 2)} ac`;
  $('lvPct').textContent = s.coveragePct != null ? `${fmt(s.coveragePct, 1)}%` : '—';
  $('lvLeft').textContent = Number.isFinite(left) ? `${fmt(left, 2)} ac` : 'No boundary';
  $('lvEta').textContent = Number.isFinite(left) && rate > 0.001 ? `${fmt(left / rate, 0)} min` : '—';
  $('liveSave').disabled = false;
}

async function stopLive() {
  const L = state.live; if (!L) return;
  await L.source.stop();
  try { await L.wake?.release(); } catch { /* already released */ }
  state.points = L.session.points;
  state.live = { ...L, stopped: true, source: null };
  $('liveStart').hidden = false; $('liveStop').hidden = true;
  $('liveSource').disabled = $('liveBoom').disabled = false;
  $('boomSwitch').disabled = true;
  $('liveSave').disabled = state.points.length < 2;
}

async function finishLive() {
  if (state.live && !state.live.stopped) await stopLive();
  const kind = state.live?.kind;
  state.live = null;
  $('liveRun').hidden = true;
  fmap?.setLive(null);
  state.rec.sourceFiles = [`Live track (${{ device: 'device GPS', serial: 'USB GPS receiver', sim: 'simulation' }[kind] || 'GPS'}), ${new Date().toLocaleString('en-US')}`];
  syncLog(); analyze(); setTimesFromLog(); markDirty();
  state.notices = [{ text: 'Live track added to this record. Live tracks carry no flow data, so enter the gallons sprayed from the sprayer controller.' }];
  state.fitPending = true;
  renderAll();
}

// ---------------------------------------------------------------- panels

function stat(k, v, unit, d, tone) {
  // every part is escaped: the detail can carry a field name the applicator typed
  return `<div class="stat"${tone ? ` data-tone="${esc(tone)}"` : ''}><span class="k">${esc(k)}</span><span class="v">${esc(v)}${unit ? `<small>${esc(unit)}</small>` : ''}</span><span class="d">${esc(d)}</span></div>`;
}

function renderStats() {
  const s = state.rec.summary, a = state.analysis;
  if (!s || !a) {
    $('stats').innerHTML = '<p class="sub">Load the flight log or track the job live, and the results show here.</p>';
    return;
  }
  const nb = !s.hasBoundary, cov = s.coveragePct;
  const gal = volumeGal(state.rec), ac = acresTreated(state.rec);
  const gpa = gal / ac, tgt = Number(state.rec.equipment.targetGpa);
  const dev = Number.isFinite(gpa) && tgt > 0 ? (gpa / tgt - 1) * 100 : NaN;
  const tiles = [
    stat('Field done', nb ? '—' : fmt(cov, 1), nb ? '' : '%', nb ? 'Choose the field to see this' : `of ${fmt(s.fieldAcres, 1)} acres`, nb ? '' : cov >= 98 ? 'ok' : cov >= 93 ? 'warn' : 'bad'),
    stat('Acres sprayed', fmt(ac, 1), 'ac', `${s.flights} flight${s.flights !== 1 ? 's' : ''}, ${s.sprayMinutes == null ? 'no times in the file' : `${fmt(s.sprayMinutes, 0)} min`}`),
    stat('Gallons', fmt(gal, 1), Number.isFinite(gal) ? 'gal' : '', state.rec.volumeGalOverride ? 'Typed in by hand' : s.volumeGal == null ? 'Not in the log: type it in at step 5, Details' : 'From the pump'),
    stat('Gallons per acre', fmt(gpa, 2), '', tgt > 0 ? `Aimed for ${fmt(tgt, 1)}${Number.isFinite(dev) ? ` (${dev >= 0 ? '+' : ''}${fmt(dev, 0)}%)` : ''}` : '', Number.isFinite(dev) ? (Math.abs(dev) > 10 ? 'warn' : 'ok') : ''),
  ];
  const findings = [];
  if (!nb) {
    const n = bigGaps(a).length;
    if (s.skipAcres >= 0.05) findings.push({ text: `${fmt(s.skipAcres, 2)} acres were missed${n ? ` (${n} spot${n > 1 ? 's' : ''}, numbered on the map)` : ''}.` });
    if (s.offTargetAcres >= 0.05) findings.push({ text: `${fmt(s.offTargetAcres, 2)} acres were sprayed outside the field.` });
    if (s.overlapAcres >= 0.5) findings.push({ text: `${fmt(s.overlapAcres, 1)} acres got sprayed twice.` });
    if (!findings.length) findings.push({ ok: true, text: 'No missed spots or spray outside the field worth noting.' });
  }
  if (Number.isFinite(dev) && Math.abs(dev) > 10) findings.push({ text: `The rate came out ${fmt(Math.abs(dev), 0)}% ${dev > 0 ? 'over' : 'under'} what you aimed for.` });
  $('stats').innerHTML = `<div class="stat-row">${tiles.join('')}</div>${findings.length ? `<ul class="findings">${findings.map(f => `<li class="${f.ok ? 'ok' : ''}">${f.text}</li>`).join('')}</ul>` : ''}`;
}

function renderGaps() {
  const a = state.analysis;
  const el = $('gaps');
  if (!a) { el.innerHTML = '<li class="none">Import a flight log to find unsprayed patches.</li>'; return; }
  if (!a.hasBoundary) { el.innerHTML = '<li class="none">Add a field boundary to find unsprayed patches.</li>'; return; }
  const gs = bigGaps(a);
  if (!gs.length) { el.innerHTML = '<li class="none">No missed spots larger than a few square yards.</li>'; return; }
  el.innerHTML = gs.map(g => {
    const c = `${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}`;
    return `<li><span><b>${fmt(acres(g.areaM2), 2)} acres</b><br><span class="coord">${c}</span></span><button type="button" class="btn copy" data-copy="${c}">Copy location</button></li>`;
  }).join('');
}

function renderFlights() {
  const a = state.analysis;
  if (!a) { $('flights').innerHTML = '<tr><td colspan="4">—</td></tr>'; return; }
  $('flights').innerHTML = a.flights.map(f => {
    const span = f.sprayStart != null ? `${hhmm(new Date(f.sprayStart))}–${hhmm(new Date(f.sprayEnd))}` : f.sprayed ? 'No times in file' : 'No spraying';
    const mins = f.sprayStart != null ? (f.sprayEnd - f.sprayStart) / 60000 : f.sprayed ? NaN : 0;
    return `<tr><td class="mono">${esc(f.id)}</td><td class="mono">${span}</td><td class="num">${fmt(mins, 1)}</td><td class="num">${a.hasFlow ? fmt(f.volumeL / L_PER_GAL, 1) : '—'}</td></tr>`;
  }).join('');
}

function renderNotices() {
  $('notices').innerHTML = state.notices.map(n => `<li class="${n.err ? 'err' : ''}">${esc(n.text)}</li>`).join('');
  const files = state.rec.sourceFiles || [];
  $('files').textContent = files.length ? `Loaded: ${files.join(', ')}` : '';
  $('btnDraw').textContent = state.boundary.length ? 'Redraw the field' : 'Draw the field';
}

// ---------------------------------------------------------------- form

function fillForm() {
  document.querySelectorAll('[data-path]').forEach(el => { el.value = getPath(state.rec, el.dataset.path) ?? ''; });
  renderModelOptions();
  renderInvoice();
  $('tzRow').hidden = !state.rec.logNaive;
  $('logTz').value = state.rec.logTimes || 'local';
  if (!state.live) $('liveBoom').value = state.rec.equipment.swathFt || 90;
  const s = state.rec.summary;
  $('f_acres').placeholder = s ? fmt(s.acresTreated, 2) + ' from GPS' : '';
  $('f_gal').placeholder = s?.volumeGal != null ? fmt(s.volumeGal, 1) + ' from GPS' : '';
  renderProducts();
}

function productOptions() {
  const mine = productsFromJobs(state.records);
  const opt = (v, t) => `<option value="${v}">${esc(t)}</option>`;
  return opt('', 'Choose a product…')
    + (mine.length ? `<optgroup label="Used on your jobs">${mine.map((p, k) => opt(`j:${k}`, p.name)).join('')}</optgroup>` : '')
    + PRODUCT_GROUPS.map(g => `<optgroup label="${g}s">${PRODUCTS.map((p, k) => (p.group === g ? opt(`c:${k}`, p.name) : '')).join('')}</optgroup>`).join('');
}

function pickProduct(i, value) {
  if (!value) return;
  const [kind, k] = value.split(':');
  const cur = state.rec.products[i];
  if (kind === 'c') state.rec.products[i] = applyCatalogProduct(cur, PRODUCTS[+k]);
  else {
    // a product from the applicator's own jobs: bring back everything they entered, rate included
    const mine = productsFromJobs(state.records)[+k];
    state.rec.products[i] = { ...blankProduct(), ...mine, fromList: true };
  }
  markDirty();
  renderProducts();
  $(`p${i}_rate`).focus();
}

function renderProducts() {
  const unitOpts = sel => UNITS.map(u => `<option value="${u}"${u === sel ? ' selected' : ''}>${u}</option>`).join('');
  const many = state.rec.products.length > 1;
  $('products').innerHTML = state.rec.products.map((p, i) => `
    <section class="product" data-i="${i}" aria-label="Product ${i + 1}">
      <div class="product-head"><h3>Product ${i + 1}</h3>${many ? `<button type="button" class="btn" data-remove="${i}">Remove</button>` : ''}</div>
      <label class="pick-row">Pick from the list
        <select id="p${i}_pick" data-pick="${i}">${productOptions()}</select>
        <span class="sub">${p.fromList ? 'Filled in from the list. Check the label for the rate, the pre-harvest days and anything left blank.' : 'Or type it in below.'}</span>
      </label>
      <div class="grid2">
        <label>Product name (trade name) <input id="p${i}_name" data-prod="name" value="${esc(p.name)}"></label>
        <label>Common name (active ingredient) <input id="p${i}_common" data-prod="common" value="${esc(p.common)}"></label>
        <label>Company on the label <input id="p${i}_company" data-prod="company" value="${esc(p.company)}"></label>
        <label>EPA Reg. No. <input id="p${i}_epa" data-prod="epa" value="${esc(p.epa)}" placeholder="e.g. 524-475"></label>
      </div>
      <div class="grid4">
        <label>Rate <input id="p${i}_rate" data-prod="rate" type="number" step="any" min="0" inputmode="decimal" value="${esc(p.rate)}"></label>
        <label>Unit, per acre <select id="p${i}_unit" data-prod="unit">${unitOpts(p.unit)}</select></label>
        <label>Re-entry, hours <input id="p${i}_rei" data-prod="rei" type="number" step="any" min="0" inputmode="decimal" value="${esc(p.rei)}"></label>
        <label>Pre-harvest, days <input id="p${i}_phi" data-prod="phi" type="number" step="1" min="0" inputmode="numeric" value="${esc(p.phi)}"></label>
      </div>
      <div class="grid2">
        <label>Active ingredient per unit <input id="p${i}_ai" data-prod="ai" value="${esc(p.ai)}" placeholder="e.g. 4 lb per gal, or 41%"></label>
        <label class="check"><input type="checkbox" id="p${i}_rup" data-prod="rup"${p.rup ? ' checked' : ''}> Restricted use product</label>
      </div>
      <div class="calc"><span>Total used: <b data-calc="total">—</b></span><span>Actual rate: <b data-calc="rate">—</b></span></div>
    </section>`).join('');
  refreshDerived();
  renderInvoice();
}

function fieldAcres() {
  if (state.analysis?.hasBoundary) return state.rec.summary.fieldAcres;
  if (!state.boundary.length) return NaN;
  const r0 = state.boundary[0][0];
  const proj = makeProjection(r0.reduce((t, p) => t + p[0], 0) / r0.length, r0.reduce((t, p) => t + p[1], 0) / r0.length);
  return boundaryArea(state.boundary.map(p => p.map(r => r.map(([la, lo]) => proj.toXY(la, lo))))) / M2_PER_ACRE;
}

function renderPlan() {
  const e = state.rec.equipment, prof = currentProfile(), d = droneById(e.model) || droneById(e.base);
  const ground = isGround(e);
  $('droneSpec').textContent = prof ? `Your saved equipment: ${prof.name}.`
    : d ? `${d.generic ? d.model : droneName(d)}: ${d.spec}`
    : 'Pick a drone or a tractor sprayer, or one you saved. Every box below can be changed.';
  $('lblSwath').textContent = ground ? 'Boom width, feet' : 'Swath, feet';
  $('eqSave').textContent = prof ? `Save changes to "${prof.name}"` : 'Save as my equipment';
  $('eqSaveNew').hidden = !prof;
  $('eqDelete').hidden = !prof;
  const gpa = Number(e.targetGpa);
  $('gpaNote').innerHTML = gpa > 0 ? `Spray volume: <b>${fmt(gpa, 1)} gallons per acre</b>. Change it in step 2, Plan.` : 'Set the gallons per acre in step 2, Plan.';
  const acres = fieldAcres();
  const out = $('planOut');
  if (!(acres > 0)) { out.innerHTML = '<p class="sub">Choose the field in step 1 to see how much spray, how many tank loads and how long the job takes.</p>'; return; }
  const p = planJob({ acres, gpa, swathFt: Number(e.swathFt), tankGal: Number(e.tankGal), flowGpm: Number(e.flowGpm), maxMph: Number(e.speedMph) || d?.speedMph || 15 });
  if (!p) { out.innerHTML = '<p class="sub">Enter the gallons per acre to see the plan.</p>'; return; }
  const hrs = h => (h == null ? '—' : h < 1 ? `${Math.round(h * 60)} min` : `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`);
  out.innerHTML = [
    stat('Field', fmt(acres, 1), 'acres', state.rec.job.field || ''),
    stat('Spray to mix', fmt(p.gallons, 0), 'gal', `${fmt(gpa, 1)} gal per acre`),
    stat('Tank loads', p.loads ?? '—', '', p.loads ? `${fmt(Number(e.tankGal), 1)} gal tank` : 'Enter the tank size'),
    stat('About', hrs(p.totalHours), '', p.acPerHour ? `${fmt(p.acPerHour, 0)} acres an hour, refills included` : ''),
  ].join('') + (p.flowLimited ? `<p class="warn">At ${fmt(gpa, 1)} gal per acre the pump limits you to about ${fmt(p.mph, 1)} mph. Use a narrower swath or more or bigger nozzles to go faster.</p>` : '')
    + (!(Number(e.flowGpm) > 0) ? `<p class="warn">Enter the pump flow to check the ${ground ? 'sprayer' : 'drone'} can keep up with this rate.</p>` : '')
    + '<p class="sub">A rough plan: real times depend on turns, battery swaps and how fast you refill.</p>';
}

function refreshDerived() {
  const r = state.rec;
  document.querySelectorAll('.product').forEach(el => {
    const p = r.products[+el.dataset.i];
    const t = p && productTotals(p, r);
    el.querySelector('[data-calc="total"]').textContent = t ? `${fmt(t.total, 1)} ${t.unit} (${fmt(t.galOrLb.value, 2)} ${t.galOrLb.unit})` : '—';
    el.querySelector('[data-calc="rate"]').textContent = t && Number.isFinite(t.actualRate) ? `${fmt(t.actualRate, 2)} ${t.unit} per acre` : '—';
  });

  renderPlan();
  const re = reentryTime(r), hv = harvestDate(r), noRei = missingRei(r);
  const maxOf = k => Math.max(...r.products.map(p => Number(p[k])).filter(Number.isFinite));
  $('intervals').innerHTML = `
    <div class="interval${re ? '' : noRei.length ? ' unknown' : ' na'}"><span class="k">Keep people out until</span><span class="v">${re ? fmtDateTime(re) : noRei.length ? 'Re-entry time unknown — check the label' : 'Enter the re-entry hours and finish time'}</span>${re ? `<span>${maxOf('rei')}-hour re-entry interval</span>` : noRei.length ? `<span>Enter the re-entry hours from the label for: ${esc(noRei.map(p => p.name).join(', '))}</span>` : ''}</div>
    <div class="interval${hv ? '' : ' na'}"><span class="k">Do not harvest before</span><span class="v">${hv ? fmtDate(hv) : 'Enter the pre-harvest days and date'}</span>${hv ? `<span>${maxOf('phi')}-day pre-harvest interval</span>` : ''}</div>`;

  const c = complianceCheck(r);
  const chip = $('complianceChip');
  chip.className = 'chip ' + (c.complete ? 'ok' : 'bad');
  chip.textContent = c.complete ? 'Complete' : `${c.missing.length} missing`;
  $('checklist').innerHTML = c.items.map(i => `<li class="${i.ok ? '' : 'miss'}">${i.ok ? esc(i.label) : `<button type="button" data-goto="${i.step}">${esc(i.label)}</button>`}</li>`).join('');
  $('docWarn').hidden = c.complete;
  $('docWarn').textContent = c.complete ? '' : `${c.missing.length} item${c.missing.length > 1 ? 's are' : ' is'} missing from the record (in red above; tap one to fill it in). You can still download the PDFs; the state record lists what's missing.`;

  $('jobTitle').textContent = r.job.field ? `${r.job.field}${r.job.date ? ', ' + fmtDate(new Date(r.job.date + 'T00:00')) : ''}` : 'New job';
  const done = {
    field: state.boundary.length > 0,
    weather: !!(r.conditions.wind && r.conditions.windDir && r.conditions.temp),
    spray: state.points.length > 1 || Number.isFinite(Number(r.job.acresOverride || NaN)),
    products: r.products.some(p => p.name) && r.products.filter(p => p.name).every(p => p.rate),
    finish: !!(r.job.farm && r.job.date && r.applicator.name && r.conditions.wind),
    docs: c.complete,
    invoice: invoiceTotals(r).total > 0,
  };
  updateInvoiceSums();
  document.querySelectorAll('.steps [data-step]').forEach(b => b.setAttribute('data-done', !!done[b.dataset.step]));
  renderStats();
}

function markDirty() {
  state.dirty = true;
  $('saveState').textContent = 'Unsaved changes';
}

// ---------------------------------------------------------------- records list

async function refreshList() {
  state.records = (await listRecords()).map(normalizeRecord);
  $('recCount').textContent = state.records.length;
  $('recEmpty').hidden = state.records.length > 0;
  $('recList').innerHTML = state.records.map(r => {
    const c = complianceCheck(r);
    const ac = acresTreated(r);
    const prods = r.products.filter(p => p.name).map(p => p.name);
    return `<li><button type="button" data-id="${r.id}">
      <span class="j-title">${esc(r.job.field || 'Field not named')}${r.job.farm ? `, ${esc(r.job.farm)}` : ''}</span>
      <span class="j-meta">${r.job.date ? fmtDate(new Date(r.job.date + 'T00:00')) : 'No date'} · ${Number.isFinite(ac) ? `${fmt(ac, 1)} acres` : 'no acres'}${prods.length ? ` · ${esc(prods.join(', '))}` : ''}</span>
      <span class="chip ${c.complete ? 'ok' : 'bad'}">${c.complete ? 'Complete' : `${c.missing.length} missing`}</span>
      ${r.savedOffline ? '<span class="chip offline">Not synced</span>' : ''}
    </button></li>`;
  }).join('');
  $('syncNote').hidden = !state.records.some(r => r.savedOffline);
  $('btnDelete').hidden = !state.records.some(r => r.id === state.rec.id);
}

function cancelLive() {
  if (!state.live) return;
  state.live.source?.stop();
  try { state.live.wake?.release(); } catch { /* ignore */ }
  state.live = null;
  $('liveRun').hidden = true; $('liveStart').hidden = false; $('liveStop').hidden = true;
  $('liveSource').disabled = $('liveBoom').disabled = false;
  fmap?.setLive(null);
}

function loadRecord(rec) {
  cancelLive();
  state.practice = false;
  state.owners.key = null;
  state.fitPending = true;
  state.rec = normalizeRecord(structuredClone(rec));
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
  cancelLive();
  // The practice job's made-up applicator and drone are never carried into a real job.
  if (state.practice) seed = null;
  state.practice = false;
  state.owners.key = null;
  state.fitPending = true;
  const r = emptyRecord();
  if (seed) {
    // keep the applicator and drone from the last job: they rarely change between fields
    r.applicator = { ...r.applicator, ...seed.applicator };
    r.equipment = { ...seed.equipment };
  }
  state.rec = r; state.points = []; state.boundary = []; state.notices = []; state.draw = null;
  $('drawBar').hidden = true;
  analyze();
  state.dirty = false; $('saveState').textContent = '';
  renderAll();
}

function loadSample() {
  cancelLive();
  state.practice = true;
  state.owners.key = null;
  state.fitPending = true;
  setTab('log');
  const j = sampleJob();
  const r = emptyRecord();
  Object.assign(r.job, j.record.job);
  r.applicator = { ...r.applicator, ...j.record.applicator };
  r.equipment = { ...j.record.equipment };
  r.products = j.record.products.map(p => ({ ...blankProduct(), ...p }));
  r.conditions = { ...r.conditions, ...j.record.conditions };
  r.notes = j.record.notes;
  r.sourceFiles = [j.fileName, 'north-40-boundary.geojson'];
  state.rec = r;
  state.points = parseFile(j.fileName, j.csv).points;
  state.boundary = j.boundary;
  state.notices = [{ text: 'Practice job: made-up names and numbers. Tap New job to start a real one.' }];
  syncLog();
  analyze();
  setTimesFromLog();
  state.dirty = true; $('saveState').textContent = 'Practice job (not saved)';
  renderAll();
}

// ---------------------------------------------------------------- invoice

/** Give the job the next invoice number the first time its invoice is opened (the applicator can change it). */
function ensureInvoiceNumber() {
  const r = state.rec;
  r.invoice ??= { number: '', ratePerAcre: '', total: 0 };
  if (String(r.invoice.number || '').trim()) return;
  r.invoice.number = nextInvoiceNumber(state.records.filter(x => x.id !== r.id));
  $('f_invNo').value = r.invoice.number;
  if (!state.practice) markDirty();
}

/** The product rows with their cost boxes. Rebuilt when the products change, not on every keystroke. */
function renderInvoice() {
  const r = state.rec;
  const rows = r.products.map((p, i) => ({ p, i })).filter(({ p }) => String(p.name || '').trim());
  $('invProducts').innerHTML = rows.length ? rows.map(({ p, i }) => {
    const t = productTotals(p, r);
    return `<div class="inv-line"><div><b>${esc(p.name)}</b><p class="sub">${t ? `${esc(fmt(t.total, 1))} ${esc(t.unit)} used` : 'Amount used not worked out yet'}</p></div>
      <label class="money-in" aria-label="Charge for ${esc(p.name)}"><span aria-hidden="true">$</span><input type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" data-invcost="${i}" value="${esc(p.invoiceCost)}"></label></div>`;
  }).join('') : '<p class="sub">No products on this job yet (step 4).</p>';
  updateInvoiceSums();
}

/** The header and the sums. Runs on every change; also keeps the saved total up to date. */
function updateInvoiceSums() {
  const r = state.rec;
  r.invoice ??= { ratePerAcre: '', total: 0 };
  const inv = invoiceTotals(r);
  r.invoice.total = inv.total;
  const taken = !state.practice && invoiceNumberTaken(state.records, r);
  $('invNoWarn').hidden = !taken;
  $('invNoWarn').textContent = taken ? `Invoice number ${r.invoice.number} is already used on another job.` : '';
  const dl = pairs => pairs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd></div>`).join('');
  $('invHead').innerHTML = dl([
    ['Customer', r.job.farm], ['Field', r.job.field],
    ['Date', r.job.date ? fmtDate(new Date(r.job.date + 'T00:00')) : ''],
    ['Acres sprayed', inv.acresKnown ? `${fmt(inv.acres, 2)} acres` : 'Not known yet (step 3 or 5)'],
  ]);
  $('invSum').innerHTML = `
    <dt>Application: ${inv.acresKnown ? `${esc(fmt(inv.acres, 2))} acres` : '0 acres'} × ${esc(fmtMoney(inv.rate))}</dt><dd id="invApp">${esc(fmtMoney(inv.application))}</dd>
    <dt>Products</dt><dd id="invProd">${esc(fmtMoney(inv.productCost))}</dd>
    <dt class="total">Total due</dt><dd class="total" id="invTotal">${esc(fmtMoney(inv.total))}</dd>`;
}

function renderAll() {
  fillForm();
  renderNotices();
  renderGaps();
  renderFlights();
  renderMap();
  refreshList();
  loadWeather();
  lookupOwners();
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

async function downloadCSV() {
  const blob = new Blob([$('exportText').value], { type: 'text/csv' });
  const name = `spray-records-${isoDate(new Date())}.csv`;
  try {
    const dl = await window.claude?.use?.('downloads').catch(() => null);
    if (dl) { await dl.save({ filename: name, data: blob }); $('exportState').textContent = 'Saved.'; return; }
  } catch (e) { $('exportState').textContent = e.code === 'declined' ? 'Not saved.' : 'Saving is not available here. Use Copy instead.'; return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('exportState').textContent = 'Saved to your downloads.';
}

// ---------------------------------------------------------------- documents

/** A clean north-up map for the documents: coverage (or the field) on white, with boundary, pins, scale and north arrow. */
function documentMap() {
  const a = state.analysis;
  if (!a && !state.boundary.length) return null;
  const W = 1100, H = 700, pad = 40;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  let proj, polys, minX, minY, maxX, maxY;
  if (a) {
    proj = a.proj; polys = a.polys;
    ({ minX, minY } = a.grid); maxX = minX + a.grid.W * a.grid.cellM; maxY = minY + a.grid.H * a.grid.cellM;
  } else {
    const r0 = state.boundary[0][0];
    const lat0 = r0.reduce((t, p) => t + p[0], 0) / r0.length, lon0 = r0.reduce((t, p) => t + p[1], 0) / r0.length;
    proj = makeProjection(lat0, lon0);
    polys = state.boundary.map(p => p.map(r => r.map(([la, lo]) => proj.toXY(la, lo))));
    const pts = polys.flatMap(p => p[0]);
    minX = Math.min(...pts.map(p => p[0])); maxX = Math.max(...pts.map(p => p[0]));
    minY = Math.min(...pts.map(p => p[1])); maxY = Math.max(...pts.map(p => p[1]));
  }
  const k = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxY - minY));
  const ox = (W - (maxX - minX) * k) / 2, oy = (H - (maxY - minY) * k) / 2;
  const sx = x => ox + (x - minX) * k, sy = y => oy + (maxY - y) * k;
  if (a) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(coverageImage(a), sx(minX), sy(maxY), (maxX - minX) * k, (maxY - minY) * k);
  } else {
    ctx.fillStyle = '#f3e3e3';
    ctx.beginPath(); polys.forEach(p => p.forEach(r => r.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)))))); ctx.fill('evenodd');
  }
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
  polys.forEach(p => p.forEach(r => { ctx.beginPath(); r.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)))); ctx.closePath(); ctx.stroke(); }));
  if (a) {
    ctx.font = 'bold 18px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    bigGaps(a).forEach((g, i) => {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx(g.x), sy(g.y), 15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#d02020'; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = '#111'; ctx.fillText(String(i + 1), sx(g.x), sy(g.y) + 1);
    });
  }
  // north arrow and scale bar
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.moveTo(W - 40, 20); ctx.lineTo(W - 52, 50); ctx.lineTo(W - 40, 43); ctx.lineTo(W - 28, 50); ctx.closePath(); ctx.fill();
  ctx.font = 'bold 18px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', W - 40, 66);
  const ftPerPx = 1 / (k * M_PER_FT);
  const len = [100, 200, 250, 500, 1000, 1320, 2640, 5280].filter(v => v / ftPerPx <= W * 0.3).pop() || 100;
  const px = len / ftPerPx;
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(20, H - 30); ctx.lineTo(20, H - 20); ctx.lineTo(20 + px, H - 20); ctx.lineTo(20 + px, H - 30); ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillText(len >= 1320 ? `${len / 5280} mile` : `${len} ft`, 28 + px, H - 24);
  return { dataUrl: c.toDataURL('image/png'), aspect: W / H };
}

async function makeDocument(kind, act, btn) {
  const out = kind === 'invoice' ? $('invState') : $('docState');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'Making the PDF…';
  try {
    if (!window.jspdf) throw new Error('The PDF maker did not load. Reload the page and try again.');
    if (!state.practice) { syncLog(); await saveRecord(markOffline(state.rec)); state.dirty = false; $('saveState').textContent = `Saved ${fmtDateTime(new Date())}`; refreshList(); }
    const ctx = {
      map: documentMap(),
      gaps: state.analysis?.hasBoundary ? bigGaps(state.analysis).map(g => ({ acres: acres(g.areaM2), lat: g.lat, lon: g.lon })) : [],
    };
    const r = state.rec;
    ctx.logo = state.logo;
    const invNo = String(r.invoice?.number || '').trim().replace(/[^A-Za-z0-9]+/g, '-');
    const doc = kind === 'customer' ? customerReport(r, ctx) : kind === 'invoice' ? invoicePdf(r, ctx) : stateRecord(r, ctx);
    const name = fileName({ customer: 'customer-report', invoice: invNo ? `invoice-${invNo}` : 'invoice' }[kind] || 'SD-application-record', r);
    const title = kind === 'customer' ? `Spray report: ${r.job.field || 'your field'}` : kind === 'invoice' ? `Invoice: ${r.job.field || 'your field'}` : `Pesticide application record ${r.job.date}`;
    const on = r.job.date ? ` on ${fmtDate(new Date(r.job.date + 'T00:00'))}` : '';
    const how = act === 'send' && shareFiles
      ? await deliverPdf(doc, name, { title, text: kind === 'customer' ? `Spray application report for ${r.job.field || 'your field'}${on}.` : kind === 'invoice' ? `Invoice for spraying ${r.job.field || 'your field'}${on}.` : '' })
      : await deliverPdf(doc, name, { title, noShare: true });
    out.className = 'doc-state ok';
    out.textContent = how === 'shared' ? 'Sent.' : how === 'cancelled' ? 'Not sent.' : `Downloaded: ${name}`;
  } catch (e) {
    out.className = 'doc-state';
    out.textContent = e.code === 'declined' ? 'Not downloaded.' : (e.message || 'The PDF could not be made.');
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

// Can this device send files through its share menu (phones and tablets usually can)?
const shareFiles = (() => {
  try { return !!navigator.canShare?.({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }); } catch { return false; }
})();

// ---------------------------------------------------------------- steps, views and text size

const STEPS = ['field', 'weather', 'spray', 'products', 'finish', 'docs', 'invoice'];
const STEP_NAMES = { field: 'Field', weather: 'Plan', spray: 'Spray', products: 'Products', finish: 'Details', docs: 'Documents', invoice: 'Invoice' };
const STEP_INFO = {
  field: ['Choose the field', 'Type the field\'s address in the box on the map, then tap the field to use it. Or draw its corners.'],
  weather: ['Plan the job', 'Pick the drone or sprayer, then check whether the weather is right for spraying.'],
  spray: ['Spray the field', 'Load the drone\'s flight log after flying, or track a ground sprayer live.'],
  products: ['What went in the tank', 'Pick each product from the list, then type the rate from its label.'],
  finish: ['Job details', 'Customer, date and time, weather and applicator. These go on both documents.'],
  docs: ['Documents', 'Check the record is complete, then download the two PDFs.'],
  invoice: ['Invoice', 'Type your rate per acre and what you charge for each product. The total adds itself up.'],
};

function showView(name) {
  $('viewHome').hidden = name !== 'home';
  $('viewJobs').hidden = name !== 'jobs';
  $('viewJob').hidden = name !== 'job';
  $('btnJobs').setAttribute('aria-pressed', name === 'jobs');
  if (name === 'job') setStep(state.step || 'field');
  else $('mapcard').hidden = true; // the map belongs to the job steps only
  scrollTo({ top: 0 });
}

function setStep(name) {
  state.step = name;
  document.querySelectorAll('.step').forEach(p => { p.hidden = p.dataset.panel !== name; });
  document.querySelectorAll('.steps [data-step]').forEach(b => b.setAttribute('aria-selected', b.dataset.step === name));
  if (name === 'invoice') { ensureInvoiceNumber(); renderInvoice(); } // product names may have changed on step 4
  const slot = document.querySelector(`[data-map-slot="${name}"]`);
  const card = $('mapcard');
  if (slot) { slot.appendChild(card); card.hidden = false; requestAnimationFrame(() => { fmap?.invalidate(); if (state.fitPending) renderMap(); }); }
  else card.hidden = true;
  const i = STEPS.indexOf(name);
  $('stepCount').textContent = `Step ${i + 1} of ${STEPS.length}`;
  $('stepTitle').textContent = STEP_INFO[name][0];
  $('stepHint').textContent = STEP_INFO[name][1];
  autoSave();
  $('stepPrev').hidden = i === 0;
  $('stepPrev').textContent = i > 0 ? `Back: ${STEP_NAMES[STEPS[i - 1]]}` : 'Back';
  $('stepNext').hidden = i === STEPS.length - 1;
  $('stepNext').textContent = i < STEPS.length - 1 ? `Next: ${STEP_NAMES[STEPS[i + 1]]}` : '';
  $('stepNext').closest('.step-nav').classList.toggle('only-back', i === STEPS.length - 1);
  if (name === 'weather') loadWeather();
}

// Jobs save themselves when you move between steps (the practice job never does).
async function autoSave() {
  if (state.practice || !state.dirty || !(state.boundary.length || state.points.length || state.rec.job.field)) return;
  syncLog();
  try {
    await saveRecord(markOffline(state.rec));
    state.dirty = false;
    $('saveState').textContent = `Saved ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    refreshList();
  } catch { $('saveState').textContent = 'Not saved: this browser is not keeping data'; }
}

const SIZES = ['', 'l', 'xl'];
function applyTextSize(sz) {
  if (sz) document.documentElement.dataset.size = sz; else delete document.documentElement.dataset.size;
  try { localStorage.setItem('sprayledger.textsize', sz); } catch { /* private mode */ }
  requestAnimationFrame(() => fmap?.invalidate());
}

// ---------------------------------------------------------------- events

function confirmClick(btn, label, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; fn(); return; }
  btn.dataset.label = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
}

let swathTimer;
function scheduleReanalyze() {
  clearTimeout(swathTimer);
  swathTimer = setTimeout(() => { analyze(); renderMap(); renderGaps(); refreshDerived(); }, 300);
}

function onFieldInput(e) {
  const t = e.target;
  if (t.closest?.('#mapcard')) return;
  if (t.dataset.path) {
    setPath(state.rec, t.dataset.path, t.value);
    // the same value can show in more than one step: keep the copies in step
    document.querySelectorAll(`[data-path="${t.dataset.path}"]`).forEach(el => { if (el !== t) el.value = t.value; });
    if (t.dataset.path === 'equipment.swathFt') scheduleReanalyze();
    if (t.dataset.path.startsWith('equipment.') && t.dataset.path !== 'equipment.targetGpa' && currentProfile()) eqMessage(`Changed for this job. Tap Save changes to keep it in "${currentProfile().name}" for next time.`);
  }
  else if (t.dataset.prod) state.rec.products[+t.closest('.product').dataset.i][t.dataset.prod] = t.type === 'checkbox' ? t.checked : t.value;
  else if (t.dataset.invcost) state.rec.products[+t.dataset.invcost].invoiceCost = t.value;
  else return;
  markDirty();
  refreshDerived();
}
document.addEventListener('input', onFieldInput);
document.addEventListener('change', e => { if (e.target.type === 'checkbox' && e.target.dataset.prod) onFieldInput(e); });
$('products').addEventListener('change', e => { const s = e.target.closest('[data-pick]'); if (s) pickProduct(+s.dataset.pick, s.value); });
$('products').addEventListener('click', e => {
  const rm = e.target.closest('[data-remove]');
  if (rm) { state.rec.products.splice(+rm.dataset.remove, 1); markDirty(); renderProducts(); }
});
$('addProduct').addEventListener('click', () => {
  state.rec.products.push(blankProduct());
  markDirty(); renderProducts();
  $(`p${state.rec.products.length - 1}_name`).focus();
});
$('btnSave').addEventListener('click', async () => {
  state.practice = false; // saving the practice job on purpose makes it a real job
  syncLog();
  try {
    await saveRecord(markOffline(state.rec));
    state.dirty = false;
    $('saveState').textContent = `Saved ${fmtDateTime(new Date())}`;
    await refreshList();
  } catch (e) {
    $('saveState').textContent = /quota/i.test(e?.name || e?.message || '') ? 'Not saved: this device is out of storage space' : 'Not saved: this browser is not keeping data';
  }
});

// Times written without a time zone: UTC (the default for new imports) or local time. Switching moves
// every point by the UTC offset. Jobs saved before UTC became the default keep 'local'.
function shiftLogTimes(want) {
  const have = state.rec.logTimes || 'local';
  if (want === have || !state.points.length) return false;
  const sign = want === 'utc' ? -1 : 1;
  state.points = state.points.map(p => ({ ...p, t: p.t + sign * new Date(p.t).getTimezoneOffset() * 60000 }));
  state.rec.logTimes = want;
  return true;
}
$('logTz').addEventListener('change', e => {
  if (!shiftLogTimes(e.target.value)) return;
  syncLog(); analyze(); setTimesFromLog(); markDirty(); renderAll();
});
$('liveSource').addEventListener('change', e => { $('baudRow').hidden = e.target.value !== 'serial'; });
for (const [id, act] of [['invSave', 'save'], ['invSend', 'send']]) {
  if (act === 'send') $(id).hidden = !shareFiles;
  $(id).addEventListener('click', e => makeDocument('invoice', act, e.currentTarget));
}
document.querySelectorAll('[data-doc]').forEach(b => {
  if (b.dataset.act === 'send') b.hidden = !shareFiles; // phones: open the text/email share menu
  b.addEventListener('click', () => makeDocument(b.dataset.doc, b.dataset.act, b));
});
$('checklist').addEventListener('click', e => { const b = e.target.closest('[data-goto]'); if (b) setStep(b.dataset.goto); });
document.querySelectorAll('.steps [data-step]').forEach(b => b.addEventListener('click', () => setStep(b.dataset.step)));
$('stepPrev').addEventListener('click', () => { setStep(STEPS[Math.max(0, STEPS.indexOf(state.step) - 1)]); scrollTo({ top: 0 }); });
$('stepNext').addEventListener('click', () => { setStep(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(state.step) + 1)]); scrollTo({ top: 0 }); });
$('btnJobs').addEventListener('click', () => showView($('viewJobs').hidden ? 'jobs' : 'job'));
$('btnText').addEventListener('click', () => applyTextSize(SIZES[(SIZES.indexOf(document.documentElement.dataset.size || '') + 1) % SIZES.length]));
$('btnLoadBoundary').addEventListener('click', () => $('fileInput').click());
$('btnHome').addEventListener('click', () => showView('home'));

// ---------------------------------------------------------------- business logo
function renderLogo() {
  const l = state.logo;
  $('logoPreview').innerHTML = l ? `<img src="${l.dataUrl}" alt="Your logo">` : '<span class="sub">No logo yet</span>';
  $('logoPickLabel').textContent = l ? 'Change logo' : 'Add your logo';
  $('logoRemove').hidden = !l;
}

/** Shrink a picture to at most 600 x 300 pixels so it stays small in the PDFs and in storage. */
function readLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Trim fully transparent edges, so the logo lines up with the page margin.
      const full = document.createElement('canvas');
      full.width = img.naturalWidth; full.height = img.naturalHeight;
      const fx = full.getContext('2d'); fx.drawImage(img, 0, 0);
      const { data, width: W, height: H } = fx.getImageData(0, 0, full.width, full.height);
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) { reject(new Error('That picture is empty. Try another file.')); return; }
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const scale = Math.min(1, 600 / cw, 300 / ch);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(cw * scale)); c.height = Math.max(1, Math.round(ch * scale));
      c.getContext('2d').drawImage(full, x0, y0, cw, ch, 0, 0, c.width, c.height);
      resolve({ dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this browser can open. Try a PNG or JPG.')); };
    img.src = url;
  });
}

$('logoInput').addEventListener('change', async e => {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  const note = $('logoState'); note.hidden = true;
  try {
    const logo = await readLogo(f);
    await setSetting('logo', logo);
    state.logo = logo; renderLogo();
  } catch (err) { note.hidden = false; note.textContent = err.message || 'The logo could not be saved.'; }
});
$('logoRemove').addEventListener('click', e => confirmClick(e.currentTarget, 'Tap again to remove', async () => {
  await setSetting('logo', null);
  state.logo = null; renderLogo();
}));

// ---------------------------------------------------------------- offline
// The app's own files come from the service worker (sw.js), so it opens with no signal. Weather and
// parcel lookups say they can't load; the map keeps drawing and coverage on its plain background.
// A job saved with no network is marked "Not synced". There is no cloud sync yet, so the mark stays:
// it never claims the job has left this device.
function markOffline(rec) { if (!navigator.onLine) rec.savedOffline = true; return rec; }
function showTileNote(blocked) {
  $('tileNote').textContent = navigator.onLine
    ? "The satellite picture can't load here. It shows when the app runs on its own web address."
    : 'No internet, so the satellite picture can\'t load. You can still draw the field and see the coverage on the plain background.';
  $('tileNote').hidden = !blocked;
}
function updateOnline() {
  const off = !navigator.onLine;
  $('offlineBadge').hidden = !off;
  if (off) showTileNote(true);
  else { showTileNote(false); fmap?.redrawTiles?.(); }
}
addEventListener('online', updateOnline);
addEventListener('offline', updateOnline);
updateOnline();

// Drone model for log imports: each maker's profile reads its own column names, units and spray switch.
// "Other / generic" reads the common column names. Only shown once a maker profile exists to choose from.
$('logProfile').innerHTML = LOG_PROFILES.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.models.length ? ` (${esc(p.models.join(', '))})` : ''}</option>`).join('');
$('logProfileRow').hidden = LOG_PROFILES.length < 2;
try { const saved = localStorage.getItem('sprayledger.logprofile'); if (saved && LOG_PROFILES.some(p => p.id === saved)) $('logProfile').value = saved; } catch { /* private mode */ }
$('logProfile').addEventListener('change', e => { try { localStorage.setItem('sprayledger.logprofile', e.target.value); } catch { /* private mode */ } });
for (const id of ['homeStart', 'homeStart2']) $(id).addEventListener('click', () => $('btnNew').click());
$('homeSample').addEventListener('click', () => $('btnSample').click());

// ---------------------------------------------------------------- equipment ("My equipment")

const currentProfile = () => {
  const m = String(state.rec.equipment.model || '');
  return m.startsWith('p:') ? state.equipmentList.find(p => p.id === m.slice(2)) || null : null;
};

function renderModelOptions() {
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const mine = sortProfiles(state.equipmentList);
  const drones = DRONES.filter(d => !d.ground);
  const makes = [...new Set(drones.filter(d => d.make).map(d => d.make))];
  $('f_model').innerHTML = opt('', 'Choose…')
    + (mine.length ? `<optgroup label="My equipment">${mine.map(p => opt(`p:${p.id}`, `${p.name}${p.drone && p.drone !== p.name ? ` (${p.drone})` : ''}`)).join('')}</optgroup>` : '')
    + makes.map(m => `<optgroup label="${esc(m)} drones">${drones.filter(d => d.make === m).map(d => opt(d.id, droneName(d))).join('')}</optgroup>`).join('')
    + `<optgroup label="Tractor and ground sprayers">${DRONES.filter(d => d.ground).map(d => opt(d.id, d.model)).join('')}</optgroup>`
    + `<optgroup label="Other">${drones.filter(d => !d.make).map(d => opt(d.id, d.model)).join('')}</optgroup>`;
  $('f_model').value = state.rec.equipment.model || '';
  if ($('f_model').value !== (state.rec.equipment.model || '')) $('f_model').value = ''; // a deleted profile
}

async function loadEquipmentList() {
  try { state.equipmentList = await listEquipment(); } catch { state.equipmentList = []; }
  renderModelOptions();
  renderPlan();
}

function eqMessage(text) { const el = $('eqState'); el.hidden = !text; el.textContent = text || ''; }

$('f_model').addEventListener('change', e => {
  const v = e.target.value, eq = state.rec.equipment;
  if (v.startsWith('p:')) {
    const p = state.equipmentList.find(x => x.id === v.slice(2));
    if (p) state.rec.equipment = applyProfile(eq, p);
    eqMessage(p ? `Filled in from your saved "${p.name}". Change anything for this job; tap Save changes to keep it for next time.` : '');
  } else {
    const d = droneById(v);
    if (d) state.rec.equipment = applyCatalogEquipment(eq, d, DRONES);
    else state.rec.equipment = { ...eq, model: '' };
    eqMessage(d?.generic ? 'Put in your own details, then tap Save as my equipment so you only enter them once.' : '');
  }
  markDirty(); fillForm(); scheduleReanalyze();
});

async function saveProfile(asNew) {
  const eq = state.rec.equipment, cur = asNew ? null : currentProfile();
  if (!String(eq.name || '').trim()) {
    eq.name = String(eq.drone || '').trim() || (isGround(eq) ? 'My ground sprayer' : 'My drone');
    $('f_eqName').value = eq.name;
  }
  const profile = profileFromEquipment(eq, { id: cur?.id });
  try {
    await saveEquipment(profile);
  } catch {
    eqMessage('Could not save: this browser is not keeping data.');
    return;
  }
  state.rec.equipment = { ...eq, model: `p:${profile.id}`, kind: profile.kind };
  markDirty();
  await loadEquipmentList();
  fillForm();
  eqMessage(cur ? `Saved the changes to "${profile.name}".` : `Saved "${profile.name}" to My equipment. Next time, pick it from the list at the top.`);
}
$('eqSave').addEventListener('click', () => saveProfile(false));
$('eqSaveNew').addEventListener('click', () => saveProfile(true));
$('eqDelete').addEventListener('click', e => confirmClick(e.currentTarget, 'Tap again to delete', async () => {
  const p = currentProfile(); if (!p) return;
  await deleteEquipment(p.id);
  // The job keeps the numbers already filled in; only the saved profile goes.
  state.rec.equipment = { ...state.rec.equipment, model: state.rec.equipment.base || '' };
  markDirty();
  await loadEquipmentList();
  fillForm();
  eqMessage(`Deleted "${p.name}" from My equipment. This job keeps its numbers.`);
}));

$('btnDelete').addEventListener('click', e => confirmClick(e.currentTarget, 'Confirm delete', async () => {
  await deleteRecord(state.rec.id);
  newRecord(state.rec);
  showView('jobs');
}));


$('fileInput').addEventListener('change', e => { importFiles(e.target.files); e.target.value = ''; });
const dz = $('dropzone');
addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
addEventListener('dragleave', e => { if (!e.relatedTarget) dz.classList.remove('drag'); });
addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files); });

$('btnNew').addEventListener('click', e => {
  const go = () => { newRecord(state.rec); state.step = 'field'; showView('job'); };
  if (state.dirty && !state.practice && (state.rec.summary || state.boundary.length)) { autoSave().then(go); return; }
  else go();
});
$('btnSample').addEventListener('click', e => {
  const go = () => { loadSample(); state.step = 'spray'; showView('job'); };
  // a real job saves itself first; the practice job has nothing worth keeping
  if (state.dirty && !state.practice) autoSave().then(go);
  else go();
});
$('recList').addEventListener('click', e => {
  const b = e.target.closest('[data-id]'); if (!b) return;
  const rec = state.records.find(r => r.id === b.dataset.id);
  if (rec) { loadRecord(rec); state.step = 'docs'; showView('job'); }
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
$('showParcels').addEventListener('change', loadViewParcels);
$('nbDist').addEventListener('change', () => lookupOwners(true));
$('ownersRefresh').addEventListener('click', () => lookupOwners(true));
$('owners').addEventListener('click', e => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  copyText(b.dataset.copy, b);
  setTimeout(() => { b.textContent = 'Copy'; }, 1500);
});
$('map').addEventListener('pointerleave', () => { $('probe').textContent = ''; });

// Drawing a boundary on the map
$('btnDraw').addEventListener('click', () => {
  state.draw = { pts: [] };
  $('drawBar').hidden = false; $('drawCount').textContent = '0';
  if (fmap) { fmap.follow = false; fmap.setParcels(state.parcelsView.list, { interactive: false }); }
  renderMap();
});
$('drawUndo').addEventListener('click', () => { state.draw?.pts.pop(); $('drawCount').textContent = state.draw?.pts.length ?? 0; fmap?.setDraft(state.draw?.pts); });
$('drawCancel').addEventListener('click', () => { state.draw = null; $('drawBar').hidden = true; fmap?.setDraft(null); renderMap(); loadViewParcels(); });
$('drawDone').addEventListener('click', () => {
  const pts = state.draw?.pts || [];
  if (pts.length < 3) { $('drawCount').textContent = `${pts.length} (need at least 3)`; return; }
  state.boundary = [[pts]];
  state.draw = null; $('drawBar').hidden = true; fmap?.setDraft(null);
  state.notices = state.notices.filter(n => !/boundary/i.test(n.text));
  state.fitPending = true;
  state.owners.key = null;
  syncLog(); analyze(); markDirty(); renderAll(); loadViewParcels();
});

// Weather
$('wxRefresh').addEventListener('click', () => loadWeather(true));
$('wxFill').addEventListener('click', async () => {
  const s = state.rec.summary, st = $('wxFillState');
  const loc = wxLocation();
  const when = state.rec.job.date ? new Date(`${state.rec.job.date}T${state.rec.job.start || '12:00'}:00`).getTime() : s?.start;
  if (!loc || !when) { st.textContent = 'Choose the field and enter the date and start time first.'; return; }
  if (when > Date.now() + 3600_000) { st.textContent = 'The application time is in the future.'; return; }
  st.textContent = 'Looking up the weather…';
  try {
    const c = await fetchConditionsAt(loc[0], loc[1], when);
    Object.assign(state.rec.conditions, { wind: c.wind, windDir: c.windDir, temp: c.temp, humidity: c.humidity, source: 'Open-Meteo (modelled, wind at 33 ft)' });
    fillForm(); markDirty();
    st.textContent = `Filled from Open-Meteo for ${dayTime(c.at)} (gusts ${Math.round(c.gust)} mph). Modelled weather: if you measured on site, use your readings.`;
  } catch (e) { st.textContent = e.message; }
});

// Live tracking
$('tabLog').addEventListener('click', () => setTab('log'));
$('tabLive').addEventListener('click', () => setTab('live'));
$('liveStart').addEventListener('click', e => {
  if (state.points.length && !state.live) confirmClick(e.currentTarget, 'Replace this record\'s track?', startLive);
  else startLive();
});
$('liveStop').addEventListener('click', stopLive);
$('liveSave').addEventListener('click', finishLive);
$('boomSwitch').addEventListener('click', () => setBoom(!state.live?.session.spray));
addEventListener('keydown', e => { if (state.live && !state.live.stopped && e.code === 'Space' && e.target === document.body) { e.preventDefault(); setBoom(!state.live.session.spray); } });

new ResizeObserver(() => fmap?.invalidate()).observe($('map').parentElement);

// ---------------------------------------------------------------- start

// Offline: keep the app's own files on the device once it has been opened online (hosted copies only).
if ('serviceWorker' in navigator && !embedded && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* works without it, just not offline */ });
}

(async () => {
  try { applyTextSize(localStorage.getItem('sprayledger.textsize') || ''); } catch { /* private mode */ }
  const ok = await persistent();
  const note = $('storageNote');
  note.hidden = false;
  note.textContent = ok
    ? 'Jobs are kept in this browser on this device. Export them now and then so you have a copy.'
    : 'This browser is not keeping data, so jobs last only until you close it. Export to keep them.';
  await refreshList();
  await loadEquipmentList();
  try { state.logo = await getSetting('logo'); } catch { state.logo = null; }
  renderLogo();
  if (state.records.length) {
    loadRecord(state.records[0]);
    showView('jobs');
  } else {
    // First visit: the welcome page. The practice job is loaded behind it, ready for "Try the practice job".
    loadSample();
    state.step = 'spray';
    showView('home');
  }
})();
