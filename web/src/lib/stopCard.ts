import { stopName, type Language, type Stop, type StopService } from "../types";

/** A route calling at a stop and where its buses go from there. */
export interface ServedBy {
  route: string;
  /** English place names, as the routes give them. */
  towards: string[];
}

const plain = (name: string) => name.trim().toLowerCase();

/**
 * The routes calling at a stop, one entry per route in route-code order, each
 * with the places its buses head for. A direction that ends here isn't
 * "towards" anywhere a rider at this stop can go, so it's left out.
 */
export function servedBy(
  services: readonly StopService[] | undefined,
  stopNameEn: string,
): ServedBy[] {
  const here = plain(stopNameEn);
  const byRoute = new Map<string, string[]>();
  for (const { route, towards } of services ?? []) {
    const places = byRoute.get(route) ?? [];
    byRoute.set(route, places);
    if (!towards || plain(towards) === here) continue;
    if (!places.some((place) => plain(place) === plain(towards)))
      places.push(towards);
  }
  return [...byRoute]
    .map(([route, towards]) => ({ route, towards }))
    .sort((a, b) =>
      a.route.localeCompare(b.route, undefined, { numeric: true }),
    );
}

/**
 * The stop's name in another language, for riders matching it to a sign:
 * English under Sinhala or Tamil, Sinhala under English. Nothing when it
 * would just repeat the main name.
 */
export function secondaryStopName(
  stop: Stop,
  language: Language,
): string | undefined {
  const other = language === "en" ? stop.stop_name_si : stop.stop_name_en;
  const name = other?.trim();
  if (!name || plain(name) === plain(stopName(stop, language))) return;
  return name;
}

/** Whether two stops are the same place; catalog stops merge several ids. */
export function sameStop(a: Stop, b: Stop & { ids?: string[] }): boolean {
  return a.id === b.id || (b.ids?.includes(a.id) ?? false);
}

export type StopTarget = "from" | "to";

export interface StopActions {
  /** The action shown as the main button. */
  primary: StopTarget;
  /** Which end of the trip this stop already is, if any. */
  current: StopTarget | null;
  /**
   * The trip the primary action completes, when the form already has the
   * other end: from that stop to here, or from here to it.
   */
  completes: { from: Stop; to?: never } | { to: Stop; from?: never } | null;
}

/**
 * Which action a stop card leads with, given the trip form. With a start
 * set, going here finishes the trip; with only a destination, starting here
 * does. Otherwise going somewhere is the usual reason to tap a stop.
 */
export function stopActions(
  stop: Stop,
  from: Stop | null,
  to: Stop | null,
): StopActions {
  const isFrom = !!from && sameStop(stop, from);
  const isTo = !!to && sameStop(stop, to);
  const current = isFrom ? "from" : isTo ? "to" : null;
  // The end this stop already is doesn't count as "set".
  const start = isFrom ? null : from;
  const end = isTo ? null : to;
  if (start) return { primary: "to", current, completes: { from: start } };
  if (end) return { primary: "from", current, completes: { to: end } };
  return { primary: "to", current, completes: null };
}

/** Opens the stop in Google Maps: the app on phones, the website elsewhere. */
export function googleMapsUrl(
  stop: Pick<Stop, "latitude" | "longitude">,
): string {
  const query = `${stop.latitude},${stop.longitude}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
