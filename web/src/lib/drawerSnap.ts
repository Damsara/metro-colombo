/** Where the phone drawer rests, from lowest to highest. */
export type Snap = "peek" | "half" | "full";

export const SNAPS: readonly Snap[] = ["peek", "half", "full"];

/** Handle, tabs and one row of content. */
export const PEEK_PX = 208;
/** Gap left between the header and the drawer at full height. */
export const FULL_GAP_PX = 8;

/** How tall the drawer stands at each snap, in pixels. */
export function snapHeights(
  viewport: number,
  header: number,
  safeBottom = 0,
): Record<Snap, number> {
  const full = Math.max(0, viewport - header - FULL_GAP_PX);
  const peek = Math.min(PEEK_PX + safeBottom, full);
  const half = Math.min(Math.max(Math.round(viewport / 2), peek), full);
  return { peek, half, full };
}

/**
 * The next snap for a tap or Enter on the handle: up from peek, down from
 * full, and onward from half in the direction it was last moving, so the
 * cycle runs peek → half → full → half → peek.
 */
export function cycleSnap(current: Snap, previous: Snap | null): Snap {
  if (current === "peek") return "half";
  if (current === "full") return "half";
  return previous === "full" ? "peek" : "full";
}

/** What the app is showing, as far as the drawer cares. */
export interface DrawerView {
  tab: "plan" | "routes";
  showResults: boolean;
  journeyKey: string | null;
  busId: string | null;
  routeCode: string | null;
  stopId: string | null;
}

/**
 * Where the drawer should go when the view changes: down to peek to watch a
 * bus or to show a stop's card over the map, up to half for new results or a
 * route. Anything else leaves it where the user put it.
 */
export function intentSnap(
  previous: DrawerView,
  next: DrawerView,
  current: Snap,
): Snap {
  if (next.busId && next.busId !== previous.busId) return "peek";
  if (next.showResults && !previous.showResults) return "half";
  if (next.routeCode && next.routeCode !== previous.routeCode) return "half";
  // A picked journey opens its steps in the drawer while the map frames it,
  // so the drawer comes up from peek but never hides the steps.
  if (next.journeyKey && next.journeyKey !== previous.journeyKey)
    return current === "peek" ? "half" : current;
  if (next.stopId && next.stopId !== previous.stopId) return "peek";
  if (next.tab !== previous.tab && current === "peek") return "half";
  return current;
}
