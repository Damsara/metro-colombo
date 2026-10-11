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

// How many zoom levels a hand-set tilt takes to blend back into the zoom-led one.
const TILT_BLEND_ZOOMS = 0.5;

export type TiltState = {
  mode: MapMode;
  reducedMotion: boolean;
  /** While the app itself animates the pitch, the camera is left alone. */
  directed: boolean;
  /** The zoom band the user tilted the map by hand in, if they did. */
  manualBand: 0 | 1 | 2 | null;
  blend: { pitch: number; zoom: number; progress: number } | null;
};

export function initialTilt(mode: MapMode): TiltState {
  return {
    mode,
    reducedMotion: false,
    directed: false,
    manualBand: null,
    blend: null,
  };
}

/** The pitch a camera update should take, or undefined to keep the one it asked for. */
export function tiltFor(
  state: TiltState,
  zoom: number,
  pitch: number,
): number | undefined {
  if (state.directed) return undefined;
  if (state.mode === "2d") return 0;
  if (state.manualBand !== null) {
    if (zoomBand(zoom) === state.manualBand) return undefined;
    state.manualBand = null;
    state.blend = { pitch, zoom, progress: 0 };
  }
  if (state.reducedMotion) return undefined;
  const target = pitchForZoom(zoom);
  const blend = state.blend;
  if (!blend) return target;
  blend.progress = Math.max(
    blend.progress,
    Math.min(1, Math.abs(zoom - blend.zoom) / TILT_BLEND_ZOOMS),
  );
  if (blend.progress === 1) state.blend = null;
  return blend.pitch + (target - blend.pitch) * blend.progress;
}
