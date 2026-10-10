import {
  useQueries,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { normalizeBuses } from "./live";
import type {
  CatalogStop,
  JourneyPlan,
  LiveFeed,
  MapRoute,
  Place,
  Route,
  RouteGeometry,
  RouteStops,
  Stop,
} from "./types";

const base = "/api";
const MINUTE_MS = 60_000;

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Transit data unavailable (HTTP ${status})`);
    this.name = "ApiError";
  }
}

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${base}${path}`, { signal });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}

/** `/routes/:code/<resource>`, for one direction when one is given. */
function routePath(
  code: string,
  resource: "stops" | "geometry",
  direction?: string,
): string {
  const path = `/routes/${encodeURIComponent(code)}/${resource}`;
  return direction === undefined
    ? path
    : `${path}?direction=${encodeURIComponent(direction)}`;
}

export function useRoutes() {
  return useQuery({
    queryKey: ["routes"],
    queryFn: async ({ signal }) =>
      (await get<{ routes: Route[] }>("/routes", signal)).routes,
    staleTime: 10 * MINUTE_MS,
  });
}

// The two platforms of one stop can sit on opposite sides of a junction, up
// to 1 km apart in the current data (Hekitta Junction holds the record).
const SAME_STOP_METERS = 1500;
const EARTH_RADIUS_METERS = 6371000;

type LatLng = Pick<Stop, "latitude" | "longitude">;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const radians = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * radians;
  const lng = (b.longitude - a.longitude) * radians;
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(lng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function useStopCatalog(routes: Route[]) {
  // Upstream gives each stop a separate id and code per direction, so the
  // same stop shows up once for each side of the road, with slightly
  // different coordinates. Same-named stops are merged only when they're
  // close together: plenty of places share a name, and a stop on another
  // road stays separate.
  // `combine` is stable per `routes`, so this only re-runs when data changes.
  const combine = useCallback(
    (queries: UseQueryResult<RouteStops[]>[]) => {
      const byName = new Map<string, CatalogStop[]>();
      queries.forEach((query, index) =>
        query.data?.forEach((direction) => {
          const route = routes[index];
          const destination = route.directions.find(
            (item) => item.id === direction.direction_id,
          )?.end_location;
          direction.stops.forEach((stop) => {
            const name = stop.stop_name_en.trim().toLowerCase();
            if (!name) return;
            const sameName = byName.get(name) ?? [];
            const existing = sameName.find(
              (item) => distanceMeters(item, stop) <= SAME_STOP_METERS,
            );
            if (!existing) {
              sameName.push({
                ...stop,
                ids: [stop.id],
                routes: [route.code],
                towards: destination ? [destination] : [],
                services: [{ route: route.code, towards: destination }],
              });
              byName.set(name, sameName);
              return;
            }
            if (!existing.ids.includes(stop.id)) existing.ids.push(stop.id);
            if (!existing.routes.includes(route.code))
              existing.routes.push(route.code);
            if (destination && !existing.towards?.includes(destination))
              existing.towards?.push(destination);
            if (
              !existing.services?.some(
                (item) =>
                  item.route === route.code && item.towards === destination,
              )
            )
              existing.services?.push({
                route: route.code,
                towards: destination,
              });
          });
        }),
      );
      const failed = queries.filter((query) => query.isError);
      return {
        stops: [...byName.values()]
          .flat()
          .sort((a, b) => a.stop_name_en.localeCompare(b.stop_name_en)),
        loading: queries.some((query) => query.isPending),
        errors: failed,
        refetch: () => failed.forEach((query) => void query.refetch()),
      };
    },
    [routes],
  );
  return useQueries({
    queries: routes.map((route) => ({
      queryKey: ["all-route-stops", route.code],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const data = await get<RouteStops | { directions: RouteStops[] }>(
          routePath(route.code, "stops"),
          signal,
        );
        return "directions" in data ? data.directions : [data];
      },
      staleTime: 30 * MINUTE_MS,
    })),
    combine,
  });
}

export function usePlaces() {
  return useQuery({
    queryKey: ["places"],
    queryFn: async ({ signal }) =>
      (await get<{ places: Place[] }>("/places", signal)).places,
    staleTime: 60 * MINUTE_MS,
  });
}

export function useRouteStops(
  code: string | undefined,
  direction: string | undefined,
) {
  return useQuery({
    queryKey: ["route-stops", code, direction],
    queryFn: ({ signal }) =>
      get<RouteStops>(routePath(code!, "stops", direction!), signal),
    enabled: !!code && !!direction,
    staleTime: 30 * MINUTE_MS,
  });
}

export function useGeometry(
  code: string | undefined,
  direction: string | undefined,
) {
  return useQuery({
    queryKey: ["geometry", code, direction],
    queryFn: ({ signal }) =>
      get<RouteGeometry>(routePath(code!, "geometry", direction!), signal),
    enabled: !!code && !!direction,
    staleTime: 30 * MINUTE_MS,
  });
}

export function useAllRouteGeometries(routes: Route[]) {
  const specs = useMemo(
    () =>
      routes.flatMap((route) =>
        route.directions.map((direction) => ({ route, direction })),
      ),
    [routes],
  );
  return useQueries({
    queries: specs.map(({ route, direction }) => ({
      queryKey: ["geometry", route.code, direction.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        get<RouteGeometry>(
          routePath(route.code, "geometry", direction.id),
          signal,
        ),
      staleTime: 30 * MINUTE_MS,
      enabled: Boolean(route.code && direction.id),
    })),
    combine: (queries) => {
      const mapRoutes: MapRoute[] = [];
      specs.forEach((spec, index) => {
        const geometry = queries[index]?.data;
        if (!geometry) return;
        mapRoutes.push({
          code: spec.route.code,
          directionId: spec.direction.id,
          color: spec.route.color_hex || "#147d57",
          geometry,
        });
      });
      return { mapRoutes, loading: queries.some((query) => query.isPending) };
    },
  });
}

export interface JourneyRequest {
  from: string;
  to: string;
  date: string;
}

export function useJourney(request: JourneyRequest | null) {
  return useQuery({
    queryKey: ["journey", request],
    queryFn: ({ signal }) =>
      get<JourneyPlan>(
        `/journey?${new URLSearchParams({ from: request!.from, to: request!.to, date: request!.date })}`,
        signal,
      ),
    enabled: !!request,
    staleTime: MINUTE_MS,
  });
}

// Upstream sends the whole fleet in one go, roughly every 5 seconds.
const FEED_INTERVAL_MS = 5000;
// Lands the poll just after the update, allowing for network jitter.
const FEED_MARGIN_MS = 400;
const FEED_RETRY_MS = 1000;

/**
 * Delay before the next /live poll, timed to land just after the next
 * upstream update rather than up to 5 s after it.
 */
export function nextLivePoll(feed: LiveFeed | undefined): number {
  const age = feed?.success ? feed.age_ms : undefined;
  // No timing to align to (old server, disconnected feed): plain interval.
  if (age === undefined || age > 2 * FEED_INTERVAL_MS) return FEED_INTERVAL_MS;
  // The update is a little late: check again shortly.
  if (age >= FEED_INTERVAL_MS) return FEED_RETRY_MS;
  return Math.max(FEED_RETRY_MS, FEED_INTERVAL_MS - age + FEED_MARGIN_MS);
}

export function useLive() {
  const query = useQuery({
    queryKey: ["live"],
    queryFn: ({ signal }) => get<LiveFeed>("/live", signal),
    refetchInterval: (query) => nextLivePoll(query.state.data),
    staleTime: 3000,
  });
  const data = useMemo(
    () =>
      query.data
        ? { ...query.data, buses: normalizeBuses(query.data.buses) }
        : query.data,
    [query.data],
  );
  return { ...query, data };
}
