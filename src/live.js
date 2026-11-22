// Live tracking: position sources and a session that turns positions into a coverage track.
//
// Sources emit fixes { t, lat, lon, accuracyM, speedMps, heading, spray? }:
//   - DeviceGPS:   the phone or tablet's own GPS (riding in the cab of a ground rig).
//   - SerialGPS:   a GPS receiver plugged in by USB (Web Serial, Chrome/Edge on a computer),
//                  reading the standard NMEA 0183 sentences most ag and RTK receivers output.
//   - SimulatedRig: drives a sprayer across a field, for demos and testing.

import { makeProjection, pointInBoundary } from './geo.js';

// ---------------------------------------------------------------- NMEA 0183

function nmeaChecksumOk(line) {
  const star = line.lastIndexOf('*');
  if (star === -1) return true; // some receivers omit it
  let x = 0;
  for (let i = 1; i < star; i++) x ^= line.charCodeAt(i);
  return x === parseInt(line.slice(star + 1, star + 3), 16);
}

function nmeaCoord(v, hemi, degDigits) {
  if (!v) return NaN;
  const deg = parseInt(v.slice(0, degDigits), 10), min = parseFloat(v.slice(degDigits));
  const d = deg + min / 60;
  return hemi === 'S' || hemi === 'W' ? -d : d;
}

/** Parses GGA (position, fix quality, HDOP) and RMC (position, speed, course). Returns null for anything else. */
export function parseNMEA(raw) {
  const line = raw.trim();
  if (!line.startsWith('$') || !nmeaChecksumOk(line)) return null;
  const f = line.split('*')[0].split(',');
  const type = f[0].slice(3);
  if (type === 'GGA') {
    const fix = parseInt(f[6], 10);
    if (!fix) return { type, fix: 0 };
    return {
      type, fix, time: f[1],
      lat: nmeaCoord(f[2], f[3], 2), lon: nmeaCoord(f[4], f[5], 3),
      sats: parseInt(f[7], 10), hdop: parseFloat(f[8]), alt: parseFloat(f[9]),
      // fix 4 = RTK fixed, 5 = RTK float: centimetre to decimetre accuracy
      rtk: fix === 4 ? 'fixed' : fix === 5 ? 'float' : null,
    };
  }
  if (type === 'RMC') {
    if (f[2] !== 'A') return { type, valid: false };
    return {
      type, valid: true, time: f[1],
      lat: nmeaCoord(f[3], f[4], 2), lon: nmeaCoord(f[5], f[6], 3),
      speedMps: parseFloat(f[7]) * 0.514444, course: parseFloat(f[8]),
    };
  }
  return null;
}

/** Rough horizontal accuracy from fix type and HDOP. */
export function nmeaAccuracyM(gga) {
  if (gga.rtk === 'fixed') return 0.03;
  if (gga.rtk === 'float') return 0.5;
  const base = gga.fix === 2 ? 1.5 : 3; // DGPS/SBAS vs autonomous
  return (Number.isFinite(gga.hdop) ? gga.hdop : 1.5) * base;
}

// ---------------------------------------------------------------- sources

export class DeviceGPS {
  static available() { return 'geolocation' in navigator; }
  label = "This device's GPS";
  start(onFix, onError) {
    this.id = navigator.geolocation.watchPosition(
      p => onFix({
        t: p.timestamp, lat: p.coords.latitude, lon: p.coords.longitude,
        accuracyM: p.coords.accuracy, speedMps: p.coords.speed ?? NaN, heading: p.coords.heading ?? NaN,
      }),
      e => onError(e.code === 1 ? 'Location permission was refused. Allow location for this site in the browser settings.' : e.code === 3 ? 'Waiting for a GPS fix…' : 'GPS position unavailable.'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }
  stop() { if (this.id != null) navigator.geolocation.clearWatch(this.id); this.id = null; }
}

export class SerialGPS {
  static available() { return 'serial' in navigator; }
  label = 'USB GPS receiver';
  constructor(baudRate = 9600) { this.baudRate = baudRate; }
  async start(onFix, onError) {
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: this.baudRate });
    } catch (e) {
      onError(e.name === 'NotFoundError' ? 'No receiver was chosen.' : `Could not open the receiver: ${e.message}`);
      return;
    }
    this.running = true;
    let last = { speedMps: NaN, course: NaN }, buf = '';
    const decoder = new TextDecoder();
    while (this.running && this.port.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split(/\r?\n/); buf = lines.pop();
          for (const l of lines) {
            const s = parseNMEA(l);
            if (!s) continue;
            if (s.type === 'RMC' && s.valid) last = { speedMps: s.speedMps, course: s.course };
            if (s.type === 'GGA') {
              if (!s.fix) { onError('Receiver has no satellite fix yet.'); continue; }
              onFix({ t: Date.now(), lat: s.lat, lon: s.lon, accuracyM: nmeaAccuracyM(s), speedMps: last.speedMps, heading: last.course, rtk: s.rtk, sats: s.sats });
            }
          }
        }
      } catch (e) { if (this.running) onError(`Receiver disconnected: ${e.message}`); }
      finally { this.reader.releaseLock(); }
    }
  }
  async stop() {
    this.running = false;
    try { await this.reader?.cancel(); } catch { /* already closed */ }
    try { await this.port?.close(); } catch { /* already closed */ }
  }
}

/** Drives a sprayer up and down a field (boustrophedon) at `speedMph`, `speedup`× real time. */
export class SimulatedRig {
  static available() { return true; }
  label = 'Simulated sprayer';
  constructor({ boundary, swathM, speedMph = 10, speedup = 12, skipPass = 5 }) {
    Object.assign(this, { boundary, swathM, speedMph, speedup, skipPass });
  }
  start(onFix) {
    const ring = this.boundary[0][0];
    const lat0 = ring.reduce((s, p) => s + p[0], 0) / ring.length, lon0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const proj = makeProjection(lat0, lon0);
    const polys = this.boundary.map(p => p.map(r => r.map(([a, b]) => proj.toXY(a, b))));
    const xs = polys[0][0].map(p => p[0]), ys = polys[0][0].map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 20, Math.max(...xs) + 20, Math.min(...ys), Math.max(...ys)];
    const v = this.speedMph * 0.44704, dt = 1;            // 1 Hz like most receivers
    const path = [];
    let pass = 0;
    for (let y = y0 + this.swathM / 2; y < y1; y += this.swathM * 0.97) {
      // Like an operator: drive only across the field on each pass, with a short turn-around margin.
      let a = null, z = null;
      for (let x = x0; x <= x1; x += 1) if (pointInBoundary(x, y, polys)) { a ??= x; z = x; }
      if (a === null) continue;
      const fwd = pass % 2 === 0;
      const [s0, s1] = [a - 12, z + 12];
      for (let k = 0; k <= (s1 - s0) / (v * dt); k++) {
        const x = fwd ? s0 + k * v * dt : s1 - k * v * dt;
        const inField = pointInBoundary(x, y, polys);
        const clog = pass === this.skipPass && x > a + (z - a) * 0.35 && x < a + (z - a) * 0.6;
        path.push({ x, y, spray: inField && !clog, heading: fwd ? 90 : 270 });
      }
      pass++;
    }
    let i = 0, t = Date.now();
    this.timer = setInterval(() => {
      if (i >= path.length) { this.stop(); return; }
      const p = path[i++];
      const [lat, lon] = proj.toLatLon(p.x + (Math.random() - 0.5) * 0.4, p.y + (Math.random() - 0.5) * 0.4);
      t += dt * 1000;
      onFix({ t, lat, lon, accuracyM: 0.4, speedMps: v, heading: p.heading, spray: p.spray });
    }, 1000 / this.speedup);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

// ---------------------------------------------------------------- session

/**
 * Collects fixes into a track. Spray state comes from the source if it knows it (simulation),
 * otherwise from the operator's boom switch in the app.
 */
export class LiveSession {
  constructor({ maxAccuracyM = 15 } = {}) {
    this.points = [];
    this.spray = false;
    this.maxAccuracyM = maxAccuracyM;
    this.last = null;
    this.rejected = 0;
  }
  add(fix) {
    this.last = fix;
    if (!(fix.accuracyM <= this.maxAccuracyM)) { this.rejected++; return false; }
    const spray = fix.spray ?? this.spray;
    const prev = this.points[this.points.length - 1];
    // Standing still: keep one point, unless the boom switch changed.
    if (prev && prev.spray === spray && Math.abs(prev.lat - fix.lat) < 2e-6 && Math.abs(prev.lon - fix.lon) < 2e-6) return false;
    this.points.push({ t: fix.t, lat: fix.lat, lon: fix.lon, flowLpm: NaN, spray, flight: 'live' });
    return true;
  }
}
