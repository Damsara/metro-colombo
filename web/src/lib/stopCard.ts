import {
  nameLanguage,
  stopName,
  type Language,
  type Stop,
  type StopService,
} from "../types";

export interface ServedBy {
  route: string;
  /** English place names, as the routes give them. */
  towards: string[];
}

const plain = (name: string) => name.trim().toLowerCase();

// A direction that ends here isn't "towards" anywhere a rider at this stop can go, so it's left out.
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

export function secondaryStopName(
  stop: Stop,
  language: Language,
): string | undefined {
  const other =
    nameLanguage(language) === "en" ? stop.stop_name_si : stop.stop_name_en;
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
  primary: StopTarget;
  current: StopTarget | null;
  completes: { from: Stop; to?: never } | { to: Stop; from?: never } | null;
}

export function stopActions(
  stop: Stop,
  from: Stop | null,
  to: Stop | null,
): StopActions {
  const isFrom = !!from && sameStop(stop, from);
  const isTo = !!to && sameStop(stop, to);
  const current = isFrom ? "from" : isTo ? "to" : null;
  const start = isFrom ? null : from;
  const end = isTo ? null : to;
  if (start) return { primary: "to", current, completes: { from: start } };
  if (end) return { primary: "from", current, completes: { to: end } };
  return { primary: "to", current, completes: null };
}

export function googleMapsUrl(
  stop: Pick<Stop, "latitude" | "longitude">,
): string {
  const query = `${stop.latitude},${stop.longitude}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
