// Satellite map (Leaflet) with the coverage raster, boundary, flight path, re-spray pins,
// downwind edges and the live position on top.

import { BASEMAPS } from './config.js';

const L = () => window.L;

export class FieldMap {
  constructor(el, { onClick, onMove, onTileStatus } = {}) {
    const Lf = L();
    this.map = Lf.map(el, { zoomSnap: 0.25, zoomControl: true, attributionControl: true, maxZoom: 21 }).setView([39.5, -96], 4);
    this.map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    this.tiles = {};
    for (const [k, b] of Object.entries(BASEMAPS)) {
      this.tiles[k] = Lf.tileLayer(b.url, { attribution: b.attribution, maxNativeZoom: b.maxNativeZoom, maxZoom: 21, crossOrigin: true });
    }
    this.basemap = 'satellite';
    this.tiles.satellite.addTo(this.map);

    // Tell the page when imagery can't load (offline, or an embedded preview that blocks outside images).
    let loaded = 0, failed = 0;
    for (const t of Object.values(this.tiles)) {
      t.on('tileload', () => { loaded++; onTileStatus?.('ok'); });
      t.on('tileerror', () => { failed++; if (!loaded && failed >= 4) onTileStatus?.('blocked'); });
    }

    this.layers = {
      coverage: null,
      boundary: Lf.layerGroup().addTo(this.map),
      track: Lf.layerGroup().addTo(this.map),
      gaps: Lf.layerGroup().addTo(this.map),
      wind: Lf.layerGroup().addTo(this.map),
      draft: Lf.layerGroup().addTo(this.map),
      live: Lf.layerGroup().addTo(this.map),
    };
    this.map.on('click', e => onClick?.([e.latlng.lat, e.latlng.lng]));
    this.map.on('mousemove', e => onMove?.([e.latlng.lat, e.latlng.lng]));
    this.map.on('dragstart', () => { this.follow = false; });

    const Ctl = Lf.Control.extend({
      onAdd: () => {
        const d = Lf.DomUtil.create('div', 'leaflet-bar basemap-ctl');
        d.innerHTML = Object.entries(BASEMAPS).map(([k, b]) => `<button type="button" data-bm="${k}" aria-pressed="${k === this.basemap}">${b.label}</button>`).join('');
        Lf.DomEvent.disableClickPropagation(d);
        d.addEventListener('click', e => { const b = e.target.closest('[data-bm]'); if (b) this.setBasemap(b.dataset.bm); });
        this.bmCtl = d;
        return d;
      },
    });
    new Ctl({ position: 'topright' }).addTo(this.map);
    this.follow = true;
  }

  setBasemap(name) {
    if (name === this.basemap) return;
    this.map.removeLayer(this.tiles[this.basemap]);
    this.tiles[name].addTo(this.map).bringToBack();
    this.basemap = name;
    this.bmCtl?.querySelectorAll('[data-bm]').forEach(b => b.setAttribute('aria-pressed', b.dataset.bm === name));
  }

  invalidate() { this.map.invalidateSize(); }

  /** Draw an analysis. `image` is a canvas of the coverage raster (north-up). */
  setAnalysis(a, image, { showTrack = false, fit = false, opacity = 0.62 } = {}) {
    const Lf = L();
    for (const k of ['boundary', 'track', 'gaps']) this.layers[k].clearLayers();
    if (this.layers.coverage) { this.map.removeLayer(this.layers.coverage); this.layers.coverage = null; }
    if (!a) return;
    const g = a.grid;
    const sw = a.proj.toLatLon(g.minX, g.minY), ne = a.proj.toLatLon(g.minX + g.W * g.cellM, g.minY + g.H * g.cellM);
    this.bounds = Lf.latLngBounds([sw, ne]);
    this.layers.coverage = Lf.imageOverlay(image.toDataURL(), this.bounds, { opacity, className: 'coverage-overlay', interactive: false }).addTo(this.map);

    const ll = ([x, y]) => a.proj.toLatLon(x, y);
    if (a.hasBoundary) {
      a.polys.forEach(p => Lf.polygon(p.map(r => r.map(ll)), { color: '#ffffff', weight: 2.5, fill: false, opacity: 0.95, interactive: false }).addTo(this.layers.boundary));
      this.bounds = Lf.latLngBounds(a.polys.flatMap(p => p[0].map(ll)));
    }
    if (showTrack) {
      let seg = [], prev = null;
      const flush = on => { if (seg.length > 1) Lf.polyline(seg, { color: on ? '#101418' : '#ffffff', weight: 1, opacity: on ? 0.6 : 0.5, dashArray: on ? null : '3 4', interactive: false }).addTo(this.layers.track); };
      for (const [x, y, on, fl] of a.track) {
        const p = ll([x, y]);
        if (prev && (prev.on !== !!on || prev.fl !== fl)) { flush(prev.on); seg = [prev.p]; }
        if (prev && prev.fl !== fl) seg = [];
        seg.push(p); prev = { on: !!on, fl, p };
      }
      if (prev) flush(prev.on);
    }
    a.gaps.filter(gp => gp.areaM2 >= 20).slice(0, 9).forEach((gp, i) => {
      Lf.marker([gp.lat, gp.lon], { icon: Lf.divIcon({ className: 'gap-pin', html: String(i + 1), iconSize: [22, 22] }), keyboard: false, interactive: false }).addTo(this.layers.gaps);
    });
    if (fit) this.fit();
  }

  fit() { if (this.bounds?.isValid()) this.map.fitBounds(this.bounds, { padding: [24, 24], maxZoom: 19 }); }

  setDraft(latlngs) {
    const Lf = L();
    this.layers.draft.clearLayers();
    if (!latlngs?.length) return;
    Lf.polyline(latlngs.length > 2 ? [...latlngs, latlngs[0]] : latlngs, { color: '#ffd23f', weight: 2.5, dashArray: '6 4', interactive: false }).addTo(this.layers.draft);
    latlngs.forEach(p => Lf.circleMarker(p, { radius: 5, color: '#ffd23f', fillColor: '#ffd23f', fillOpacity: 1, interactive: false }).addTo(this.layers.draft));
  }

  /** Highlight field edges that face downwind. edgesLL: [[[lat,lon],[lat,lon]], ...]. */
  setDownwind(edgesLL, label) {
    const Lf = L();
    this.layers.wind.clearLayers();
    for (const e of edgesLL || []) {
      Lf.polyline(e, { color: '#ffb000', weight: 7, opacity: 0.85, lineCap: 'butt', interactive: true })
        .bindTooltip(label, { sticky: true }).addTo(this.layers.wind);
    }
  }

  setLive(fix, swathM) {
    const Lf = L();
    this.layers.live.clearLayers();
    if (!fix) return;
    const rot = Number.isFinite(fix.heading) ? fix.heading : 0;
    Lf.circle([fix.lat, fix.lon], { radius: Math.max(fix.accuracyM || 0, 0.5), color: '#3aa0ff', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(this.layers.live);
    Lf.marker([fix.lat, fix.lon], {
      icon: Lf.divIcon({ className: 'rig-pin', iconSize: [30, 30], html: `<svg viewBox="0 0 30 30" style="transform:rotate(${rot}deg)"><path d="M15 3 L24 25 L15 20 L6 25 Z" fill="#3aa0ff" stroke="#fff" stroke-width="2"/></svg>` }),
      interactive: false, keyboard: false,
    }).addTo(this.layers.live);
    if (this.follow) {
      const z = Math.max(this.map.getZoom(), swathM > 15 ? 17 : 18);
      this.map.setView([fix.lat, fix.lon], z, { animate: false });
    }
  }
}
