import { useMemo } from "react";
import { distanceMeters, useRoutes, useRouteStops } from "../api";
import { busJourney, type BusJourney, type JourneyMarks } from "../lib/busCard";
import { busPosition } from "../lib/tracking";
import { busDirection, type LiveBus } from "../types";
import { useLiveBuses } from "./useLiveBuses";

export type BusJourneyResult =
  | { status: "ready"; journey: BusJourney }
  | { status: "loading" }
  | { status: "unknown"; reason: "noRoute" | "noDirection" | "offRoute" };

export function useBusJourney(
  bus: LiveBus | null,
  marks?: JourneyMarks,
): BusJourneyResult | null {
  const routes = useRoutes();
  const routeCodeById = useMemo(
    () => new Map(routes.data?.map((route) => [route.id, route.code])),
    [routes.data],
  );
  const { routeCodeOf } = useLiveBuses(routeCodeById);
  const routeCode = bus ? routeCodeOf(bus) : undefined;
  const route = routes.data?.find((route) => route.code === routeCode);
  const directionId = busDirection(route, bus?.direction_id)?.id;
  const query = useRouteStops(directionId ? routeCode : undefined, directionId);
  const stops = useMemo(
    () =>
      (query.data?.stops ?? [])
        .slice()
        .sort((a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0)),
    [query.data?.stops],
  );
  const onRoute =
    bus !== null &&
    stops.some(
      (stop) =>
        distanceMeters({ latitude: bus.lat, longitude: bus.lng }, stop) <= 800,
    );
  const position = bus && onRoute ? busPosition(bus, stops) : null;
  const present = bus !== null;
  const hasRoute = Boolean(bus?.route_code || bus?.route_id);
  const plate = bus?.registration_number;
  const boardId = marks?.boardId;
  const alightId = marks?.alightId;
  return useMemo(() => {
    if (!present) return null;
    if (!hasRoute) return { status: "unknown", reason: "noRoute" };
    if (routes.isPending) return { status: "loading" };
    if (!routeCode) return { status: "unknown", reason: "noRoute" };
    if (!directionId) return { status: "unknown", reason: "noDirection" };
    if (query.isPending) return { status: "loading" };
    const journey = busJourney(routeCode, directionId, stops, position, {
      boardId,
      alightId,
    });
    return journey
      ? { status: "ready", journey }
      : { status: "unknown", reason: "offRoute" };
  }, [
    present,
    hasRoute,
    plate,
    routeCode,
    directionId,
    routes.isPending,
    query.isPending,
    stops,
    position,
    boardId,
    alightId,
  ]);
}
