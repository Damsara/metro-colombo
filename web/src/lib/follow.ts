import { LOST_AFTER_MS } from "./tracking";

/** What the user asked of the camera for the selected bus. */
export type FollowMode = "following" | "lookingAround";

/**
 * The selected bus as the map, pill and tracking panel all show it: the
 * user's mode while the bus is in the live feed, else how long it has been
 * gone.
 */
export type FollowState = FollowMode | "waiting" | "lost";

/** How far a drag must go before it lets go of the bus. */
export const DRAG_RELEASE_PX = 30;

export type FollowEvent =
  | { type: "select" }
  | { type: "follow" }
  | { type: "tapSelected" }
  | { type: "drag"; distance: number }
  | { type: "pan" };

export function nextFollowMode(
  mode: FollowMode,
  event: FollowEvent,
): FollowMode {
  switch (event.type) {
    case "select":
    case "follow":
      return "following";
    case "tapSelected":
      return mode === "following" ? "lookingAround" : "following";
    case "drag":
      return event.distance >= DRAG_RELEASE_PX ? "lookingAround" : mode;
    case "pan":
      return "lookingAround";
  }
}

export function followState(
  mode: FollowMode,
  missingSince: number | null,
  now: number,
): FollowState {
  if (missingSince === null) return mode;
  return now - missingSince >= LOST_AFTER_MS ? "lost" : "waiting";
}

/** When the bus has been gone long enough to count as lost, or null if it's here. */
export function lostAt(missingSince: number | null): number | null {
  return missingSince === null ? null : missingSince + LOST_AFTER_MS;
}

/** Whether the bus is reporting, which is all the pulsing dot means. */
export function liveSignal(state: FollowState | null): boolean {
  return state === "following" || state === "lookingAround";
}

export function dragDistance(
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}
