// Equipment: the drone or ground sprayer on a job, and saved profiles ("My equipment") so an applicator
// enters a rig's details once and picks it from the list after that.

import { droneById, droneName, litersToGal, lpmToGpm } from './catalog.js';

export const DRONE_GPA = 2, GROUND_GPA = 15;

/** The fields a profile carries. Everything else on a job (field, products, weather…) stays per job. */
export const PROFILE_FIELDS = ['name', 'drone', 'serial', 'swathFt', 'tankGal', 'flowGpm', 'speedMph', 'targetGpa'];

const newId = () => globalThis.crypto?.randomUUID?.() ?? `eq-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Is this equipment a ground (tractor-type) sprayer? */
export function isGround(eq) {
  if (eq.kind) return eq.kind === 'ground';
  return !!droneById(eq.model)?.ground;
}

/** A saved profile made from what's in the boxes now. Keeps its id when updating an existing profile. */
export function profileFromEquipment(eq, { id, name } = {}) {
  const p = { id: id || newId(), kind: isGround(eq) ? 'ground' : 'drone', base: eq.base || (String(eq.model || '').startsWith('p:') ? '' : eq.model || ''), updatedAt: Date.now() };
  for (const k of PROFILE_FIELDS) p[k] = eq[k] ?? '';
  p.name = String(name ?? eq.name ?? '').trim() || String(eq.drone || '').trim() || (p.kind === 'ground' ? 'My ground sprayer' : 'My drone');
  return p;
}

/** Fill a job's equipment from a saved profile. */
export function applyProfile(eq, profile) {
  const out = { ...eq, model: `p:${profile.id}`, kind: profile.kind, base: profile.base || '' };
  for (const k of PROFILE_FIELDS) out[k] = profile[k] ?? '';
  return out;
}

/**
 * Fill a job's equipment from a list entry (a drone model or a ground sprayer type). A name the applicator
 * typed for the make and model is kept; a name that came from the list is replaced.
 */
export function applyCatalogEquipment(eq, entry, catalog) {
  const listNames = catalog.map(droneName);
  const typedName = eq.drone && !listNames.some(n => eq.drone === n || eq.drone.startsWith(n)) && !/^(Ground sprayer|Other drone)$/.test(eq.drone);
  const out = { ...eq, model: entry.id, kind: entry.ground ? 'ground' : 'drone', base: entry.id, name: '' };
  // Drones and ground rigs spray at very different rates, so switching between them resets the starting
  // rate (2 or 15 gal/ac); the label's rate is what counts, and the applicator changes it in the box.
  const wasGround = eq.model ? isGround(eq) : false;
  if (!!entry.ground !== wasGround || !(Number(eq.targetGpa) > 0)) out.targetGpa = entry.ground ? GROUND_GPA : DRONE_GPA;
  if (!typedName) out.drone = entry.generic ? '' : droneName(entry);
  out.swathFt = entry.swathFt ?? '';
  out.tankGal = entry.tankGal ?? (entry.tankL != null ? +litersToGal(entry.tankL).toFixed(1) : '');
  out.flowGpm = entry.flowLpm != null ? +lpmToGpm(entry.flowLpm).toFixed(2) : (entry.flowGpm ?? '');
  out.speedMph = entry.speedMph ?? '';
  return out;
}

/** Sort saved profiles for the pick list: drones first, then ground sprayers, each by name. */
export function sortProfiles(list) {
  return [...list].sort((a, b) => (a.kind === b.kind ? String(a.name).localeCompare(String(b.name)) : a.kind === 'drone' ? -1 : 1));
}
