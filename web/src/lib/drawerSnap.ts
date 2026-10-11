export type Snap = "peek" | "half" | "full";

export const SNAPS: readonly Snap[] = ["peek", "half", "full"];

export const PEEK_PX = 208;
export const FULL_GAP_PX = 8;

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

export function cycleSnap(current: Snap, previous: Snap | null): Snap {
  if (current === "peek") return "half";
  if (current === "full") return "half";
  return previous === "full" ? "peek" : "full";
}

export interface DrawerView {
  tab: "plan" | "routes";
  showResults: boolean;
  journeyKey: string | null;
  busId: string | null;
  routeCode: string | null;
  stopId: string | null;
  tracking: boolean;
}

export function intentSnap(
  previous: DrawerView,
  next: DrawerView,
  current: Snap,
): Snap {
  if (next.tracking && !previous.tracking) return "peek";
  if (!next.tracking && previous.tracking) return "half";
  if (next.busId && next.busId !== previous.busId) return "peek";
  if (next.showResults && !previous.showResults) return "half";
  if (next.routeCode && next.routeCode !== previous.routeCode) return "half";
  // A picked journey opens its steps in the drawer, which comes up from peek but never hides them.
  if (next.journeyKey && next.journeyKey !== previous.journeyKey)
    return current === "peek" ? "half" : current;
  if (next.stopId && next.stopId !== previous.stopId) return "half";
  if (next.tab !== previous.tab && current === "peek") return "half";
  return current;
}
