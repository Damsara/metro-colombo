import { useMemo } from "react";
import { distanceMeters, useRouteStops } from "../api";
import { busJourney, type BusJourney, type JourneyMarks } from "../lib/busCard";
import { busPosition, orderedStops } from "../lib/tracking";
import { busDirection, type LiveBus } from "../types";
import { useTransitData } from "./TransitData";

export interface BusLine {
  routeCode: string;
  directionId: string;
}

export type BusJourneyResult = (
  | { status: "ready"; journey: BusJourney }
  | { status: "loading" }
  | { status: "unknown"; reason: "noRoute" | "noDirection" | "offRoute" }
) & { line?: BusLine };

export function useBusJourney(
  bus: LiveBus | null,
  marks?: JourneyMarks,
): BusJourneyResult | null {
  const { routes, routeCodeById, routesQuery } = useTransitData();
  const routeCode = bus
    ? (bus.route_code ?? routeCodeById.get(bus.route_id ?? ""))
    : undefined;
  const route = routes.find((route) => route.code === routeCode);
  const directionId = busDirection(route, bus?.direction_id)?.id;
  const query = useRouteStops(directionId ? routeCode : undefined, directionId);
  const stops = useMemo(
    () => orderedStops(query.data?.stops ?? []),
    [query.data?.stops],
  );
  const lat = bus?.lat;
  const lng = bus?.lng;
  const position = useMemo(() => {
    if (lat === undefined || lng === undefined) return null;
    const onRoute = stops.some(
      (stop) => distanceMeters({ latitude: lat, longitude: lng }, stop) <= 800,
    );
    return onRoute ? busPosition({ lat, lng }, stops) : null;
  }, [lat, lng, stops]);
  const present = bus !== null;
  const hasRoute = Boolean(bus?.route_code || bus?.route_id);
  const boardId = marks?.boardId;
  const alightId = marks?.alightId;
  return useMemo(() => {
    if (!present) return null;
    if (!hasRoute) return { status: "unknown", reason: "noRoute" };
    if (routesQuery.isPending) return { status: "loading" };
    if (!routeCode) return { status: "unknown", reason: "noRoute" };
    if (!directionId) return { status: "unknown", reason: "noDirection" };
    const line = { routeCode, directionId };
    if (query.isPending) return { status: "loading", line };
    const journey = busJourney(routeCode, directionId, stops, position, {
      boardId,
      alightId,
    });
    return journey
      ? { status: "ready", journey, line }
      : { status: "unknown", reason: "offRoute", line };
  }, [
    present,
    hasRoute,
    routeCode,
    directionId,
    routesQuery.isPending,
    query.isPending,
    stops,
    position,
    boardId,
    alightId,
  ]);
}
