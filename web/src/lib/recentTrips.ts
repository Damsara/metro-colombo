import type { CatalogStop } from "../types";

export interface RecentStop {
  code: string;
  name: string;
}

export interface RecentTrip {
  from: RecentStop;
  to: RecentStop;
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "lmt-go:recent-trips";
export const RECENT_TRIP_LIMIT = 5;

function isRecentStop(value: unknown): value is RecentStop {
  const stop = value as RecentStop | null;
  return (
    typeof stop === "object" &&
    stop !== null &&
    typeof stop.code === "string" &&
    typeof stop.name === "string"
  );
}

function isRecentTrip(value: unknown): value is RecentTrip {
  const trip = value as RecentTrip | null;
  return (
    typeof trip === "object" &&
    trip !== null &&
    isRecentStop(trip.from) &&
    isRecentStop(trip.to)
  );
}

function sameTrip(a: RecentTrip, b: RecentTrip): boolean {
  return a.from.code === b.from.code && a.to.code === b.to.code;
}

// localStorage can be missing or throw (private mode, blocked site data).
function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function addRecentTrip(
  trips: readonly RecentTrip[],
  trip: RecentTrip,
): RecentTrip[] {
  return [trip, ...trips.filter((item) => !sameTrip(item, trip))].slice(
    0,
    RECENT_TRIP_LIMIT,
  );
}

export function loadRecentTrips(
  store: KeyValueStore | null = defaultStore(),
): RecentTrip[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecentTrip)
      .reduce<RecentTrip[]>(
        (trips, trip) =>
          trips.some((item) => sameTrip(item, trip)) ? trips : [...trips, trip],
        [],
      )
      .slice(0, RECENT_TRIP_LIMIT);
  } catch {
    return [];
  }
}

export function saveRecentTrips(
  trips: readonly RecentTrip[],
  store: KeyValueStore | null = defaultStore(),
): void {
  try {
    store?.setItem(KEY, JSON.stringify(trips));
  } catch {
    // Full or blocked storage: the list still works for this visit.
  }
}

export function clearRecentTrips(
  store: KeyValueStore | null = defaultStore(),
): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // Storage may be unavailable.
  }
}

export function recentStop(stop: CatalogStop): RecentStop {
  return { code: stop.stop_code, name: stop.stop_name_en };
}

export function findStop(
  stops: readonly CatalogStop[],
  stop: RecentStop,
): CatalogStop | undefined {
  return stops.find((item) => item.stop_code === stop.code);
}

export function recentStops(
  trips: readonly RecentTrip[],
  stops: readonly CatalogStop[],
  limit = 4,
): CatalogStop[] {
  const found: CatalogStop[] = [];
  for (const trip of trips) {
    for (const stop of [trip.to, trip.from]) {
      const entry = findStop(stops, stop);
      if (entry && !found.includes(entry)) found.push(entry);
    }
  }
  return found.slice(0, limit);
}
