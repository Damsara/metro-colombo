export const CHASE_PITCH = 72;
export const CHASE_ZOOM = 20.3;
export const CHASE_MAX_PITCH = 80;
// Share of the map's height the bus sits below the centre, leaving the road ahead in view.
const BUS_DROP = 0.2;
// About how long the camera takes to catch up with a turn.
const TURN_MS = 450;
const REDUCED_MOTION_STEP = 20;

const normalise = (degrees: number) => ((degrees % 360) + 360) % 360;

export function chaseBearing(
  current: number,
  heading: number | undefined,
  elapsedMs: number,
  reducedMotion: boolean,
): number {
  if (heading === undefined || !Number.isFinite(heading)) return current;
  const turn = ((normalise(heading) - normalise(current) + 540) % 360) - 180;
  if (reducedMotion)
    return Math.abs(turn) >= REDUCED_MOTION_STEP
      ? normalise(heading)
      : normalise(current);
  return normalise(current + turn * (1 - Math.exp(-elapsedMs / TURN_MS)));
}

export function chaseOffset(mapHeight: number, followShift: number): number {
  return Math.round(mapHeight * BUS_DROP) - followShift;
}
