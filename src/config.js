// Outside services. Check each provider's terms before charging customers:
// Esri World Imagery and the OpenStreetMap tile servers are free for light, non-commercial use;
// a paid product should use a keyed plan (Esri, MapTiler, Mapbox...). Open-Meteo is free for
// non-commercial use and has an inexpensive commercial API plan.

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// The first entry is the default. `overlays` are drawn on top of the base pictures (roads and place names).
export const BASEMAPS = {
  hybrid: {
    label: 'Hybrid',
    url: ESRI_IMAGERY,
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics; roads and places &copy; Esri, HERE, Garmin',
    maxNativeZoom: 19,
    overlays: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    ],
  },
  satellite: {
    label: 'Satellite',
    url: ESRI_IMAGERY,
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 19,
  },
  streets: {
    label: 'Streets',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxNativeZoom: 19,
  },
};

export const WEATHER = {
  forecastUrl: 'https://api.open-meteo.com/v1/forecast',
  archiveUrl: 'https://archive-api.open-meteo.com/v1/archive',
};

// Defaults for the go / caution / no-go rating. The product label is the legal limit: when a label
// is stricter (many say 10 mph or less, some less), lower these to match.
export const SPRAY_LIMITS = {
  windMinMph: 3,      // below this, inversions and drifting fines are likely
  windMaxMph: 10,
  gustMaxMph: 15,
  deltaTMinF: 3.6,    // Delta T 2–8 °C is the usual good range (3.6–14.4 °F)
  deltaTMaxF: 14.4,
  deltaTStopF: 18,    // over 10 °C: droplets evaporate before landing
  tempMaxF: 90,
  rainChanceMax: 40,  // % chance within the next 2 hours
};
