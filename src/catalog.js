// Pick lists: spray drones for planning and common products for the tank mix.
//
// Every number here was checked against the maker's announcement or spec page, or the
// EPA-stamped label, in November 2026. Labels and specs change: the product label in hand is the
// legal authority, and anything left blank (null) here could not be confirmed and is for the
// applicator to copy from the label. Edit this file to add the drones and products you use.

// ---------- spray drones ----------
// tankL: spray tank. flowLpm: rated spray flow with the standard nozzles (null when sources disagree).
// swathFt: a conservative starting swath inside the maker's range; set your own calibrated swath.
export const DRONES = [
  { id: 'dji-t100', make: 'DJI', model: 'Agras T100', tankL: 100, flowLpm: 30, swathFt: 33,
    spec: '100 L tank, 30 L/min (40 with four sprinklers). Swath roughly 5–11 m depending on height and nozzles.' },
  { id: 'dji-t70p', make: 'DJI', model: 'Agras T70P', tankL: 70, flowLpm: 30, swathFt: 30,
    spec: '70 L tank, 30 L/min (40 with four sprinklers), 4–11 m swath.' },
  { id: 'dji-t50', make: 'DJI', model: 'Agras T50', tankL: 40, flowLpm: 16, swathFt: 30,
    spec: '40 L tank, 16 L/min with two sprinklers (24 with four), 4–11 m swath at 3 m height.' },
  { id: 'dji-t25', make: 'DJI', model: 'Agras T25', tankL: 20, flowLpm: 16, swathFt: 20,
    spec: '20 L tank, 16 L/min with two sprinklers (24 with four), 4–7 m swath.' },
  { id: 'xag-p100pro', make: 'XAG', model: 'P100 Pro', tankL: 50, flowLpm: 22, swathFt: 26,
    spec: '50 L tank, 22 L/min dual pump, 5–10 m swath.' },
  { id: 'hylio-ag272', make: 'Hylio', model: 'AG-272', tankL: 68, flowLpm: null, swathFt: 35,
    spec: '18 gal (68 L) tank, swath up to 40 ft. Published flow rates disagree: enter yours.' },
  { id: 'hylio-ag230', make: 'Hylio', model: 'AG-230', tankL: 30, flowLpm: null, swathFt: 30,
    spec: '8 gal (two 4 gal tanks), swath up to 35 ft. Published flow rates vary: enter yours.' },
  { id: 'ground', make: '', model: 'Ground sprayer', tankL: null, flowLpm: null, swathFt: 90, ground: true, maxMph: 12,
    spec: 'Enter your boom width, tank size and pump flow.' },
  { id: 'other', make: '', model: 'Other drone', tankL: null, flowLpm: null, swathFt: 25,
    spec: 'Enter the tank size, flow and swath from your drone.' },
];

export const droneById = id => DRONES.find(d => d.id === id) || null;
export const droneName = d => [d.make, d.model].filter(Boolean).join(' ');

// ---------- products ----------
// rei in hours. rup = restricted use. Rates and PHIs depend on crop and pest, so they are never filled in.
export const PRODUCT_GROUPS = ['Herbicide', 'Fungicide', 'Insecticide', 'Adjuvant'];
export const PRODUCTS = [
  // Herbicides
  { group: 'Herbicide', name: 'Roundup PowerMAX 3', common: 'glyphosate (potassium salt)', company: 'Bayer CropScience', epa: '524-659', ai: null, rei: 4 },
  { group: 'Herbicide', name: 'Enlist One', common: '2,4-D choline salt', company: 'Corteva Agriscience', epa: '62719-695', ai: null, rei: 48 },
  { group: 'Herbicide', name: 'Liberty ULTRA', common: 'glufosinate-P-ammonium', company: 'BASF', epa: '7969-500', ai: '18.7%', rei: null },
  { group: 'Herbicide', name: 'Callisto', common: 'mesotrione', company: 'Syngenta', epa: '100-1131', ai: '4 lb per gal', rei: 12 },
  { group: 'Herbicide', name: 'Dual II Magnum', common: 'S-metolachlor + safener', company: 'Syngenta', epa: '100-818', ai: '7.64 lb per gal', rei: 24 },
  { group: 'Herbicide', name: 'GrazonNext HL', common: 'aminopyralid + 2,4-D', company: 'Corteva Agriscience', epa: '62719-628', ai: null, rei: 48 },
  { group: 'Herbicide', name: 'Tordon 22K', common: 'picloram', company: 'Corteva Agriscience', epa: '62719-6', ai: null, rei: 12, rup: true },
  // Fungicides
  { group: 'Fungicide', name: 'Headline SC', common: 'pyraclostrobin', company: 'BASF', epa: '7969-289', ai: null, rei: 12 },
  { group: 'Fungicide', name: 'Headline AMP', common: 'pyraclostrobin + metconazole', company: 'BASF', epa: '7969-291', ai: null, rei: 12 },
  { group: 'Fungicide', name: 'Trivapro', common: 'azoxystrobin + propiconazole + benzovindiflupyr', company: 'Syngenta', epa: '100-1613', ai: null, rei: null },
  { group: 'Fungicide', name: 'Miravis Neo', common: 'pydiflumetofen + azoxystrobin + propiconazole', company: 'Syngenta', epa: '100-1605', ai: '0.63 + 0.83 + 1.04 lb per gal', rei: null },
  { group: 'Fungicide', name: 'Delaro Complete', common: 'prothioconazole + trifloxystrobin + fluopyram', company: 'Bayer CropScience', epa: '264-1207', ai: '1.47 + 1.29 + 1.07 lb per gal', rei: null },
  { group: 'Fungicide', name: 'Veltyma', common: 'mefentrifluconazole + pyraclostrobin', company: 'BASF', epa: '7969-409', ai: '1.67 + 1.67 lb per gal', rei: 12 },
  // Insecticides
  { group: 'Insecticide', name: 'Warrior II with Zeon Technology', common: 'lambda-cyhalothrin', company: 'Syngenta', epa: '100-1295', ai: null, rei: 24, rup: true },
  { group: 'Insecticide', name: 'Mustang Maxx', common: 'zeta-cypermethrin', company: 'FMC', epa: '279-3426', ai: null, rei: null, rup: true },
  { group: 'Insecticide', name: 'Hero', common: 'zeta-cypermethrin + bifenthrin', company: 'FMC', epa: '279-3315', ai: '0.309 + 0.927 lb per gal', rei: null, rup: true },
  // Adjuvants (not EPA-registered: brand and company are yours to fill in)
  { group: 'Adjuvant', name: 'Non-ionic surfactant (NIS)', common: 'non-ionic surfactant', company: null, epa: null, ai: null, rei: null },
  { group: 'Adjuvant', name: 'Crop oil concentrate (COC)', common: 'crop oil concentrate', company: null, epa: null, ai: null, rei: null },
  { group: 'Adjuvant', name: 'Methylated seed oil (MSO)', common: 'methylated seed oil', company: null, epa: null, ai: null, rei: null },
  { group: 'Adjuvant', name: 'Ammonium sulfate (AMS)', common: 'ammonium sulfate', company: null, epa: null, ai: null, rei: null },
];

/**
 * Fill a product from a catalog entry. Only label facts are copied; rate, unit and PHI are left as they were.
 * Blank catalog values don't overwrite what the applicator already typed.
 */
export function applyCatalogProduct(product, entry) {
  const out = { ...product, name: entry.name };
  for (const k of ['common', 'company', 'epa', 'ai']) if (entry[k]) out[k] = entry[k]; else if (!product[k] || product.fromList) out[k] = '';
  out.rei = entry.rei != null ? String(entry.rei) : (product.fromList ? '' : product.rei);
  out.rup = !!entry.rup;
  out.fromList = true;
  return out;
}

/** Products the applicator has used on saved jobs, newest first, deduplicated by name (keeps their rates too). */
export function productsFromJobs(records) {
  const seen = new Map();
  for (const r of records) for (const p of r.products || []) {
    const key = String(p.name || '').trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

// ---------- planning ----------
const L_PER_GAL = 3.785411784, M2_PER_ACRE = 4046.8564224, M_PER_FT = 0.3048;

/**
 * Rough job plan. acres, gpa (gal/ac), swathFt, tankGal, flowGpm (optional), maxMph (optional cap).
 * Returns gallons, tank loads, the ground speed the pump allows, and time with refills.
 */
export function planJob({ acres, gpa, swathFt, tankGal, flowGpm, maxMph = 15, refillMin = 4, turnFactor = 0.8 }) {
  if (!(acres > 0) || !(gpa > 0)) return null;
  const gallons = acres * gpa;
  const loads = tankGal > 0 ? Math.ceil(gallons / tankGal - 1e-9) : null;
  let mph = maxMph, flowLimited = false;
  if (flowGpm > 0 && swathFt > 0) {
    // acres per minute the pump can cover = flow / rate; speed = area per minute / swath width
    const acPerMin = flowGpm / gpa;
    const pumpMph = (acPerMin * M2_PER_ACRE / (swathFt * M_PER_FT)) / 1609.344 * 60;
    if (pumpMph < mph) { mph = pumpMph; flowLimited = true; }
  }
  const acPerHour = swathFt > 0 ? (mph * 1609.344 * swathFt * M_PER_FT) / M2_PER_ACRE * turnFactor : null;
  const sprayHours = acPerHour ? acres / acPerHour : null;
  const totalHours = sprayHours != null ? sprayHours + ((loads || 1) * refillMin) / 60 : null;
  return { acres, gpa, gallons, liters: gallons * L_PER_GAL, loads, mph, flowLimited, acPerHour, sprayHours, totalHours };
}

export const litersToGal = l => (l == null ? null : l / L_PER_GAL);
export const lpmToGpm = l => (l == null ? null : l / L_PER_GAL);
