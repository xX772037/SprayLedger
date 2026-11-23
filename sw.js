// Offline support: keep the app's own files on the device so it opens with no signal in the field.
// Outside data (map pictures, weather, parcels) always comes from the network and is not stored here.
// Every file the app loads must be listed here (test/offline.test.js checks it), or the app won't open offline.
const CACHE = 'sprayledger-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg',
  'src/app.js', 'src/catalog.js', 'src/config.js', 'src/coverage.js', 'src/docs.js', 'src/equipment.js', 'src/geo.js', 'src/live.js',
  'src/map.js', 'src/parcels.js', 'src/parse.js', 'src/records.js', 'src/sample.js', 'src/store.js', 'src/weather.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/jspdf/jspdf.umd.min.js',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  'vendor/fonts/atkinson-hyperlegible-latin-400-italic.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// The app's own files: use the network when there is signal (so updates arrive), the stored copy when there isn't.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))),
  );
});
