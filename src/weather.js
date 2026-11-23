// Spray-weather assessment: forecast fetch, Delta T, inversion risk, go / caution / no-go per hour,
// spray windows, drift direction and downwind field edges.

import { WEATHER, SPRAY_LIMITS } from './config.js';
import { ringArea } from './geo.js';

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass8 = deg => COMPASS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
export const compass16 = deg => COMPASS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

const fToC = f => (f - 32) * 5 / 9;

/** Wet-bulb temperature (°C) from air temperature (°C) and relative humidity (%), Stull (2011). */
export function wetBulbC(tC, rh) {
  return tC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(tC + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) - 4.686035;
}

/** Delta T in °F (dry bulb minus wet bulb): a measure of how fast spray droplets evaporate. */
export function deltaTF(tempF, rh) {
  const t = fToC(tempF);
  return (t - wetBulbC(t, rh)) * 9 / 5;
}

/**
 * Rate one hour. `h` = { temp °F, rh %, wind mph, gust mph, dir deg (from), t80 °F | null, precip in, rainSoon % }.
 * Returns { status: 'go' | 'caution' | 'no', reasons: [{ level, text }] }, most serious reason first.
 */
export function assessHour(h, L = SPRAY_LIMITS) {
  const reasons = [];
  const add = (level, text) => reasons.push({ level, text });
  const w = Math.round(h.wind);
  if (h.wind > L.windMaxMph) add(2, `Wind ${w} mph is over the ${L.windMaxMph} mph limit`);
  else if (h.wind > L.windMaxMph - 2) add(1, `Wind ${w} mph is close to the ${L.windMaxMph} mph limit`);
  if (h.gust > L.gustMaxMph + 5) add(2, `Gusts to ${Math.round(h.gust)} mph`);
  else if (h.gust > L.gustMaxMph) add(1, `Gusts to ${Math.round(h.gust)} mph`);

  const inversion = h.t80 != null && h.t80 - h.temp >= 1 && h.wind < 6;
  if (inversion) add(2, `Temperature inversion likely: air 260 ft up is ${Math.round(h.t80 - h.temp)}°F warmer than at the ground, so fine droplets can hang and move off-site`);
  else if (h.wind < L.windMinMph) add(1, `Wind under ${L.windMinMph} mph: watch for an inversion and drift in unpredictable directions`);

  const dt = deltaTF(h.temp, h.rh);
  if (dt > L.deltaTStopF) add(2, `Very dry air (Delta T ${dt.toFixed(1)}°F): droplets evaporate before they land`);
  else if (dt > L.deltaTMaxF) add(1, `Dry air (Delta T ${dt.toFixed(1)}°F): consider coarser droplets`);
  else if (dt < L.deltaTMinF && !inversion) add(1, `Humid, still air (Delta T ${dt.toFixed(1)}°F) keeps fine droplets airborne`);

  if (h.temp > L.tempMaxF) add(1, `${Math.round(h.temp)}°F: higher evaporation and volatility`);
  if (h.precip > 0.01) add(2, 'Raining');
  else if (h.rainSoon >= L.rainChanceMax) add(1, `${Math.round(h.rainSoon)}% chance of rain in the next 2 hours: check the label's rainfast period`);

  reasons.sort((a, b) => b.level - a.level);
  const lvl = reasons.reduce((m, r) => Math.max(m, r.level), 0);
  return { status: ['go', 'caution', 'no'][lvl], reasons, deltaT: dt, inversion };
}

/** Turn an Open-Meteo hourly response into rated hours with real timestamps (ms). */
export function parseForecast(json, L = SPRAY_LIMITS) {
  const H = json.hourly, off = (json.utc_offset_seconds || 0) * 1000;
  const n = H.time.length;
  const hours = [];
  for (let i = 0; i < n; i++) {
    const rainSoon = Math.max(...[0, 1, 2].map(k => H.precipitation_probability?.[i + k] ?? 0));
    const h = {
      t: Date.parse(H.time[i] + 'Z') - off,
      temp: H.temperature_2m[i], rh: H.relative_humidity_2m[i],
      wind: H.wind_speed_10m[i], gust: H.wind_gusts_10m?.[i] ?? H.wind_speed_10m[i], dir: H.wind_direction_10m[i],
      t80: H.temperature_80m?.[i] ?? null, precip: H.precipitation?.[i] ?? 0, rainSoon,
    };
    if ([h.temp, h.rh, h.wind, h.dir].some(v => v == null)) continue;
    hours.push({ ...h, ...assessHour(h, L) });
  }
  return hours;
}

/** Contiguous runs of 'go' hours: [{ start, end }] where end is the end of the last good hour. */
export function sprayWindows(hours, fromMs = -Infinity) {
  const out = [];
  let cur = null;
  for (const h of hours) {
    if (h.t + 3600_000 <= fromMs) continue;
    if (h.status === 'go') {
      if (cur && cur.end === h.t) cur.end = h.t + 3600_000;
      else { cur = { start: Math.max(h.t, fromMs), end: h.t + 3600_000 }; out.push(cur); }
    }
    else cur = null;
  }
  return out;
}

/**
 * Which way drift goes, and which field edges face downwind.
 * polysXY: boundary polygons in local metres; windFromDeg: meteorological direction (where wind comes FROM).
 * Returns { towardDeg, edges: [[ [x1,y1], [x2,y2] ], ...] } for outer-ring edges facing within 60° of downwind.
 */
export function downwindEdges(polysXY, windFromDeg) {
  const toward = (windFromDeg + 180) % 360;
  const rad = toward * Math.PI / 180;
  const v = [Math.sin(rad), Math.cos(rad)];          // x = east, y = north
  const edges = [];
  for (const poly of polysXY) {
    const ring = poly[0];
    const ccw = ringArea(ring) > 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const n = ccw ? [dy / len, -dx / len] : [-dy / len, dx / len]; // outward normal
      if (n[0] * v[0] + n[1] * v[1] > 0.5) edges.push([a, b]);
    }
  }
  return { towardDeg: toward, edges };
}

// ---------- network ----------

const HOURLY = 'temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_80m';
const UNITS = 'temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto';

async function getJSON(url, fetchImpl) {
  let res;
  try { res = await fetchImpl(url); }
  catch { throw new Error('Weather service unreachable. Check the connection; embedded previews block outside data.'); }
  if (res.status === 429) throw new Error('The weather service is busy (its free daily limit was reached for this connection). Try again later.');
  if (!res.ok) throw new Error(`The weather service isn't answering right now (error ${res.status}). Try again later.`);
  return res.json();
}

export async function fetchForecast(lat, lon, { fetchImpl = fetch, days = 2 } = {}) {
  const url = `${WEATHER.forecastUrl}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=${HOURLY}&${UNITS}&forecast_days=${days}&past_days=0`;
  return parseForecast(await getJSON(url, fetchImpl));
}

/** Conditions at a past moment (for filling in a record): forecast API for the last ~3 months, archive before that. */
export async function fetchConditionsAt(lat, lon, ms, { fetchImpl = fetch } = {}) {
  const d = new Date(ms);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const recent = Date.now() - ms < 85 * 86400_000;
  const base = recent ? WEATHER.forecastUrl : WEATHER.archiveUrl;
  const vars = recent ? HOURLY : 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
  const json = await getJSON(`${base}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=${vars}&${UNITS}&start_date=${day}&end_date=${day}`, fetchImpl);
  const hours = parseForecast(json);
  if (!hours.length) throw new Error('No weather data for that date.');
  const h = hours.reduce((best, x) => (Math.abs(x.t - ms) < Math.abs(best.t - ms) ? x : best));
  return {
    wind: String(Math.round(h.wind)), windDir: h.wind < 1 ? 'Calm' : compass8(h.dir),
    temp: String(Math.round(h.temp)), humidity: String(Math.round(h.rh)),
    gust: h.gust, at: h.t,
  };
}
