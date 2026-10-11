export type MapMode = "2d" | "3d";

export const MAP_MODE_KEY = "lmt.mapMode";
export const OVERVIEW_ZOOM = 12;
export const STREET_ZOOM = 15;
export const OVERVIEW_PITCH = 25;
export const STREET_PITCH = 50;
export const ISOMETRIC_FOV = 15;
export const BUILDINGS_MIN_ZOOM = 14;
export const BUILDINGS_FULL_ZOOM = 15;
export const BUILDING_HEIGHT_SCALE = 0.6;
const LOW_DEVICE_MEMORY_GB = 4;

/** The 3D tilt for a zoom: low over the city, steeper at street level. */
export function pitchForZoom(zoom: number): number {
  const progress = Math.min(
    1,
    Math.max(0, (zoom - OVERVIEW_ZOOM) / (STREET_ZOOM - OVERVIEW_ZOOM)),
  );
  // Smoothstep, so the tilt doesn't kink as a zoom crosses either band edge.
  const eased = progress * progress * (3 - 2 * progress);
  return OVERVIEW_PITCH + (STREET_PITCH - OVERVIEW_PITCH) * eased;
}

/** 0 for the city overview, 1 in between, 2 at street level. */
export function zoomBand(zoom: number): 0 | 1 | 2 {
  if (zoom <= OVERVIEW_ZOOM) return 0;
  return zoom >= STREET_ZOOM ? 2 : 1;
}

export type DeviceFacts = {
  webgl2: boolean;
  saveData?: boolean;
  deviceMemory?: number;
};

export function canShowBuildings(facts: DeviceFacts): boolean {
  if (!facts.webgl2 || facts.saveData === true) return false;
  return (
    typeof facts.deviceMemory !== "number" ||
    !Number.isFinite(facts.deviceMemory) ||
    facts.deviceMemory >= LOW_DEVICE_MEMORY_GB
  );
}

export function parseMapMode(stored: unknown): MapMode | null {
  return stored === "2d" || stored === "3d" ? stored : null;
}
