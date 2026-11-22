import { parseFile } from './parse.js';
import { computeCoverage, acres } from './coverage.js';
import { M_PER_FT, L_PER_GAL } from './geo.js';
import {
  emptyRecord, UNITS, productTotals, reentryTime, harvestDate, complianceCheck, recordsToCSV,
  fmt, isoDate, hhmm, fmtDateTime, fmtDate, acresTreated, volumeGal,
} from './records.js';
import { listRecords, saveRecord, deleteRecord, packPoints, unpackPoints, persistent } from './store.js';
import { sampleJob } from './sample.js';
import { FieldMap } from './map.js';
import { fetchForecast, fetchConditionsAt, assessHour, sprayWindows, downwindEdges, compass16 } from './weather.js';
import { DeviceGPS, SerialGPS, SimulatedRig, LiveSession } from './live.js';
import { SPRAY_LIMITS } from './config.js';

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
    onTileStatus: s => { $('tileNote').hidden = s !== 'blocked'; },
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
  if (a) state.fitPending = false;
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
  renderWeather(); renderDownwind();
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
  if (state.wxLoading) { body.innerHTML = '<p class="hint">Getting the forecast for this field…</p>'; chip.textContent = ''; return; }
  if (state.wxError) {
    chip.textContent = ''; where.textContent = '';
    body.innerHTML = `<p class="hint">${esc(state.wxError)}</p><div><button type="button" class="btn btn-small" id="wxExample">Show an example forecast</button></div>`;
    $('wxExample').addEventListener('click', exampleWeather);
    return;
  }
  const now = wxNow();
  if (!now) { chip.textContent = ''; where.textContent = ''; body.innerHTML = '<p class="hint">Load a field or start tracking to see the wind and spray forecast for that spot.</p>'; return; }

  const label = { go: 'Good to spray', caution: 'Spray with caution', no: 'Don’t spray now' }[now.status];
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
    <div class="hours" role="list" aria-label="Next 24 hours">${upcoming.map(h => `
      <div class="hour${h === now ? ' now' : ''}" role="listitem" title="${esc(`${dayTime(h.t)}: ${Math.round(h.wind)} mph from ${compass16(h.dir)}, gusts ${Math.round(h.gust)}. ${h.reasons.map(r => r.text).join('. ') || 'Within limits.'}`)}">
        <span class="bar" data-s="${h.status}">${Math.round(h.wind)}</span>${arrowSvg((h.dir + 180) % 360)}<span class="t">${hourLabel(h.t)}</span>
      </div>`).join('')}
    </div>
    <p class="wx-windows">${wins.length ? `Spray windows: ${wins.map(w => `<b>${dayTime(w.start)}–${new Date(w.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</b>`).join(' · ')}` : 'No good spray window in the forecast. Bars show wind in mph; hover a bar for the reasons.'}</p>
    ${state.analysis?.hasBoundary ? `<p class="wx-drift">Drift moves toward the <b>${compass16(toward)}</b>. The field edges facing that way are marked on the map: keep your buffer there and check what lies downwind (sensitive crops, homes, water, bee yards). Start on the downwind side and work upwind so the rig stays out of its own drift.</p>` : ''}
    <p class="wx-note">Ratings use wind ${SPRAY_LIMITS.windMinMph}–${SPRAY_LIMITS.windMaxMph} mph, gusts under ${SPRAY_LIMITS.gustMaxMph} mph and Delta T ${SPRAY_LIMITS.deltaTMinF}–${SPRAY_LIMITS.deltaTMaxF}°F. Forecast wind is for 33 ft above ground. The product label is the legal limit: if it is stricter, follow the label.</p>`;
}

function renderDownwind() {
  if (!fmap) return;
  const a = state.analysis, now = wxNow();
  if (!a?.hasBoundary || !now || now.wind < 1) { fmap.setDownwind([]); return; }
  const { edges, towardDeg } = downwindEdges(a.polys, now.dir);
  fmap.setDownwind(edges.map(e => e.map(([x, y]) => a.proj.toLatLon(x, y))), `Downwind edge: drift goes ${compass16(towardDeg)} today`);
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
    source = new SerialGPS();
  } else {
    if (!state.boundary.length) {
      state.boundary = sampleJob().boundary;
      state.notices = [{ text: 'No field boundary yet, so the simulation drives the sample field.' }];
      state.fitPending = true;
    }
    source = new SimulatedRig({ boundary: state.boundary, swathM, speedMph: 10, speedup: 15 });
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
  $('lvAcc').textContent = fix.rtk ? `RTK ${fix.rtk}` : `±${fmt(fix.accuracyM / M_PER_FT, 0)} ft`;
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
  state.fitPending = true;
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
  cancelLive();
  state.fitPending = true;
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
  cancelLive();
  state.fitPending = true;
  setTab('log');
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
  loadWeather();
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
  const img = state.analysis ? coverageImage(state.analysis).toDataURL('image/png') : null;
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
$('map').addEventListener('pointerleave', () => { $('probe').textContent = ''; });

// Drawing a boundary on the map
$('btnDraw').addEventListener('click', () => {
  state.draw = { pts: [] };
  $('drawBar').hidden = false; $('drawCount').textContent = '0';
  if (fmap) fmap.follow = false;
  renderMap();
});
$('drawUndo').addEventListener('click', () => { state.draw?.pts.pop(); $('drawCount').textContent = state.draw?.pts.length ?? 0; fmap?.setDraft(state.draw?.pts); });
$('drawCancel').addEventListener('click', () => { state.draw = null; $('drawBar').hidden = true; fmap?.setDraft(null); renderMap(); });
$('drawDone').addEventListener('click', () => {
  const pts = state.draw?.pts || [];
  if (pts.length < 3) { $('drawCount').textContent = `${pts.length} (need at least 3)`; return; }
  state.boundary = [[pts]];
  state.draw = null; $('drawBar').hidden = true; fmap?.setDraft(null);
  state.notices = state.notices.filter(n => !/boundary/i.test(n.text));
  state.fitPending = true;
  syncLog(); analyze(); markDirty(); renderAll();
});

// Weather
$('wxRefresh').addEventListener('click', () => loadWeather(true));
$('wxFill').addEventListener('click', async () => {
  const s = state.rec.summary, st = $('wxFillState');
  const when = state.rec.job.date ? new Date(`${state.rec.job.date}T${state.rec.job.start || '12:00'}:00`).getTime() : s?.start;
  if (!s || !when) { st.textContent = 'Load the flight log first so the field location and time are known.'; return; }
  if (when > Date.now() + 3600_000) { st.textContent = 'The application time is in the future.'; return; }
  st.textContent = 'Looking up the weather…';
  try {
    const c = await fetchConditionsAt(s.lat, s.lon, when);
    Object.assign(state.rec.conditions, { wind: c.wind, windDir: c.windDir, temp: c.temp, humidity: c.humidity });
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

(async () => {
  const ok = await persistent();
  const note = $('storageNote');
  note.hidden = false;
  note.textContent = ok ? 'Records are stored in this browser on this device. Export regularly to keep a copy.' : 'This browser is not keeping data, so saved records last only until the tab closes. Export to keep them.';
  await refreshList();
  if (state.records.length) loadRecord(state.records[0]);
  else loadSample();
})();
