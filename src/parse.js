// Importers for drone flight logs and field boundaries.
// Output shapes:
//   point:    { t: ms epoch (or ms since start if meta.relativeTime), lat, lon, alt, speed, flowLpm, spray: bool, flight }
//   boundary: [ [outerRing, ...holes], ... ] with rings of [lat, lon]

import { L_PER_GAL } from './geo.js';

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF, and ; or tab delimiters. */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const delim = [',', ';', '\t'].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// Header synonyms seen across drone apps and ground-station exports. First match wins.
const COLS = {
  time: ['timestamp', 'time', 'datetime', 'date_time', 'gps_time', 'utc', 'time_utc', 'elapsed_s', 'elapsed', 'time_s', 'seconds'],
  lat: ['latitude', 'lat', 'gps_lat', 'lat_deg', 'gps_latitude'],
  lon: ['longitude', 'lon', 'lng', 'long', 'gps_lon', 'gps_lng', 'lon_deg', 'gps_longitude'],
  alt: ['altitude_m', 'altitude', 'alt', 'height', 'height_m', 'relative_alt', 'alt_m'],
  speed: ['speed_mps', 'speed', 'ground_speed', 'groundspeed', 'speed_m_s'],
  flow: ['flow_l_min', 'flow_lpm', 'flow_rate', 'flow', 'spray_rate', 'flowrate', 'flow_gpm', 'flow_gal_min', 'flow_ml_min', 'pump_flow'],
  spray: ['spraying', 'spray', 'spray_on', 'spray_status', 'pump', 'pump_on', 'sprayer', 'nozzle_on'],
  flight: ['flight', 'flight_id', 'sortie', 'mission', 'flight_no', 'flight_number', 'sortie_id'],
};

export function detectColumns(header) {
  const h = header.map(norm);
  const out = {};
  for (const [key, names] of Object.entries(COLS)) {
    let idx = -1;
    for (const n of names) { idx = h.indexOf(n); if (idx !== -1) break; }
    if (idx === -1) idx = h.findIndex(x => names.some(n => x.startsWith(n + '_')));
    out[key] = idx;
  }
  return out;
}

function flowFactor(headerName) {
  const n = norm(headerName);
  if (/gal|gpm/.test(n)) return L_PER_GAL;      // gal/min -> L/min
  if (/ml/.test(n)) return 0.001;               // mL/min  -> L/min
  return 1;
}

const TRUE = new Set(['1', 'true', 'on', 'yes', 'y', 'spraying', 'open']);

/** Returns { ms, relative } or null. Accepts ISO strings, epoch s/ms, or elapsed seconds. */
export function parseTime(v) {
  const s = String(v).trim();
  if (s === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 1e12) return { ms: n, relative: false };
    if (n > 1e9) return { ms: n * 1000, relative: false };
    return { ms: n * 1000, relative: true };
  }
  const ms = Date.parse(s.includes(' ') && !s.includes('T') && /^\d{4}-/.test(s) ? s.replace(' ', 'T') : s);
  return Number.isNaN(ms) ? null : { ms, relative: false };
}

export function parseFlightCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('The file has no data rows.');
  const header = rows[0];
  const c = detectColumns(header);
  if (c.lat === -1 || c.lon === -1) {
    throw new Error('Could not find latitude and longitude columns. Expected headers such as "latitude" and "longitude".');
  }
  const warnings = [];
  const ff = c.flow !== -1 ? flowFactor(header[c.flow]) : 1;
  const points = [];
  let relative = false, skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const lat = parseFloat(r[c.lat]), lon = parseFloat(r[c.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) { skipped++; continue; }
    const tm = c.time !== -1 ? parseTime(r[c.time]) : null;
    if (tm?.relative) relative = true;
    const flow = c.flow !== -1 ? parseFloat(r[c.flow]) * ff : NaN;
    let spray;
    if (c.spray !== -1) spray = TRUE.has(String(r[c.spray]).trim().toLowerCase());
    else spray = Number.isFinite(flow) && flow > 0.05;
    points.push({
      t: tm ? tm.ms : (i - 1) * 1000,
      lat, lon,
      alt: c.alt !== -1 ? parseFloat(r[c.alt]) : NaN,
      speed: c.speed !== -1 ? parseFloat(r[c.speed]) : NaN,
      flowLpm: Number.isFinite(flow) ? flow : NaN,
      spray,
      flight: c.flight !== -1 ? String(r[c.flight]).trim() : null,
    });
  }
  if (!points.length) throw new Error('No rows had valid GPS coordinates.');
  if (skipped) warnings.push(`${skipped} row${skipped > 1 ? 's' : ''} without a GPS fix were skipped.`);
  if (c.time === -1) warnings.push('No time column found; assumed one row per second. Enter the date and times by hand.');
  else if (relative) warnings.push('Times are seconds since takeoff, so the date and clock times need to be entered by hand.');
  if (c.flow === -1) warnings.push('No flow-rate column found, so the volume applied cannot be measured from this log. Enter it by hand.');
  if (c.spray === -1 && c.flow === -1) warnings.push('No spray on/off or flow column: every point is treated as not spraying.');
  return {
    points: assignFlights(points),
    warnings,
    meta: { hasFlow: c.flow !== -1, hasSpray: c.spray !== -1, hasTime: c.time !== -1, relativeTime: relative, columns: c },
  };
}

/** Use the log's flight column if present; otherwise start a new flight after a gap of more than 60 s. */
export function assignFlights(points, gapMs = 60000) {
  if (points.some(p => p.flight !== null && p.flight !== '')) return points;
  let n = 1;
  points.forEach((p, i) => {
    if (i > 0 && p.t - points[i - 1].t > gapMs) n++;
    p.flight = String(n);
  });
  return points;
}

// ---------- GeoJSON ----------

export function parseGeoJSON(obj) {
  if (typeof obj === 'string') obj = JSON.parse(obj);
  const boundary = [], points = [];
  const feats = obj.type === 'FeatureCollection' ? obj.features : obj.type === 'Feature' ? [obj] : [{ type: 'Feature', geometry: obj, properties: {} }];
  const ll = c => [c[1], c[0]];
  for (const f of feats) {
    const g = f.geometry; if (!g) continue;
    const props = f.properties || {};
    const times = props.coordTimes || props.times || null;
    if (g.type === 'Polygon') boundary.push(g.coordinates.map(r => r.map(ll)));
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => boundary.push(p.map(r => r.map(ll))));
    else if (g.type === 'LineString' || g.type === 'MultiLineString') {
      const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
      lines.forEach((line, li) => line.forEach((c, i) => {
        const tt = Array.isArray(times?.[0]) ? times[li]?.[i] : times?.[i];
        const tm = tt != null ? parseTime(tt) : null;
        points.push({ t: tm ? tm.ms : points.length * 1000, lat: c[1], lon: c[0], alt: c[2] ?? NaN, speed: NaN, flowLpm: NaN, spray: props.spraying ?? true, flight: String(props.flight ?? li + 1) });
      }));
    } else if (g.type === 'Point') {
      const tm = props.time != null ? parseTime(props.time) : null;
      const flow = parseFloat(props.flow_l_min ?? props.flow ?? NaN);
      points.push({ t: tm ? tm.ms : points.length * 1000, lat: g.coordinates[1], lon: g.coordinates[0], alt: g.coordinates[2] ?? NaN, speed: NaN, flowLpm: flow, spray: props.spraying ?? flow > 0, flight: props.flight != null ? String(props.flight) : null });
    }
  }
  return { boundary, points: points.length ? assignFlights(points) : points };
}

// ---------- KML ----------

function kmlCoords(s) {
  return s.trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(c => c.length >= 2 && c.every(Number.isFinite));
}

export function parseKML(text) {
  const boundary = [], points = [];
  const ll = c => [c[1], c[0]];
  for (const m of text.matchAll(/<(?:\w+:)?Polygon\b[\s\S]*?<\/(?:\w+:)?Polygon>/g)) {
    const block = m[0];
    const outer = block.match(/<(?:\w+:)?outerBoundaryIs>[\s\S]*?<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/);
    if (!outer) continue;
    const holes = [...block.matchAll(/<(?:\w+:)?innerBoundaryIs>[\s\S]*?<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/g)];
    boundary.push([kmlCoords(outer[1]).map(ll), ...holes.map(h => kmlCoords(h[1]).map(ll))]);
  }
  let flight = 0;
  for (const m of text.matchAll(/<(?:\w+:)?LineString\b[\s\S]*?<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/g)) {
    flight++;
    for (const c of kmlCoords(m[1])) points.push({ t: points.length * 1000, lat: c[1], lon: c[0], alt: c[2] ?? NaN, speed: NaN, flowLpm: NaN, spray: true, flight: String(flight) });
  }
  for (const m of text.matchAll(/<gx:Track\b[\s\S]*?<\/gx:Track>/g)) {
    flight++;
    const whens = [...m[0].matchAll(/<when>([^<]+)<\/when>/g)].map(x => parseTime(x[1]));
    const coords = [...m[0].matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)].map(x => x[1].trim().split(/\s+/).map(Number));
    coords.forEach((c, i) => points.push({ t: whens[i]?.ms ?? points.length * 1000, lat: c[1], lon: c[0], alt: c[2] ?? NaN, speed: NaN, flowLpm: NaN, spray: true, flight: String(flight) }));
  }
  return { boundary, points };
}

/** Parse any supported file by extension, falling back to sniffing the content. */
export function parseFile(name, text) {
  const ext = name.toLowerCase().split('.').pop();
  const t = text.trimStart();
  if (ext === 'kml' || t.startsWith('<?xml') || t.startsWith('<kml')) {
    const r = parseKML(text);
    return { ...r, warnings: r.points.length ? ['KML tracks carry no flow data, so the volume applied must be entered by hand.'] : [], meta: { hasFlow: false } };
  }
  if (ext === 'geojson' || ext === 'json' || t.startsWith('{')) {
    const r = parseGeoJSON(text);
    return { ...r, warnings: [], meta: { hasFlow: r.points.some(p => Number.isFinite(p.flowLpm)) } };
  }
  const r = parseFlightCSV(text);
  return { boundary: [], points: r.points, warnings: r.warnings, meta: r.meta };
}
