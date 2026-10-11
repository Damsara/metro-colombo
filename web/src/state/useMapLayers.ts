import { useMemo } from "react";
import { planTabBuses } from "../lib/mapBuses";
import {
  resolveBusDirectionId,
  type JourneyOption,
  type LiveBus,
  type Route,
  type RouteRef,
  type Stop,
} from "../types";

interface MapLayerInputs {
  tab: "plan" | "routes";
  routes: Route[];
  buses: LiveBus[];
  selectedBus: LiveBus | null;
  routeCodeOf: (bus: LiveBus) => string | undefined;
  /** The route shown in the panel (the open route, or the journey's first ride). */
  activeRoute: Route | undefined;
  direction: string | undefined;
  selectedJourney: JourneyOption | null;
  resultOptions: readonly JourneyOption[] | null;
  trackedJourney: JourneyOption | null;
  trackedBus: LiveBus | null;
  routeStops: Stop[] | undefined;
  allStops: Stop[];
}

/** What the map should draw, worked out from the panel's state. */
export function useMapLayers({
  tab,
  routes,
  buses,
  selectedBus,
  routeCodeOf,
  activeRoute,
  direction,
  selectedJourney,
  resultOptions,
  trackedJourney,
  trackedBus,
  routeStops,
  allStops,
}: MapLayerInputs) {
  // A followed bus pins the map to its own route and direction.
  const routeLock = useMemo(() => {
    if (!selectedBus) return null;
    const code = routeCodeOf(selectedBus);
    if (!code) return null;
    const route = routes.find((item) => item.code === code);
    return {
      routeCode: code,
      directionId: resolveBusDirectionId(route, selectedBus.direction_id),
    };
  }, [selectedBus, routes, routeCodeOf]);

  const stops = routeStops ?? allStops;

  // On the Bus routes tab, only the open route's buses (or the followed
  // bus's route) are shown, heading the way the panel is showing.
  const routesTabBuses = useMemo(() => {
    const code =
      (selectedBus && routeCodeOf(selectedBus)) ?? activeRoute?.code ?? null;
    if (!code) return buses;
    return buses.filter((bus) => {
      if (bus.route_code !== code) return false;
      if (selectedBus || !activeRoute || !direction || !bus.direction_id) {
        return true;
      }
      return resolveBusDirectionId(activeRoute, bus.direction_id) === direction;
    });
  }, [buses, selectedBus, activeRoute, direction, routeCodeOf]);

  const planTabBusList = useMemo(() => {
    const chosen = trackedJourney ?? selectedJourney;
    const journeys = chosen ? [chosen] : resultOptions;
    return planTabBuses({
      buses,
      routes,
      routeCodeOf,
      journeys,
      keep: [selectedBus, trackedBus],
    });
  }, [
    buses,
    routes,
    routeCodeOf,
    trackedJourney,
    selectedJourney,
    resultOptions,
    selectedBus,
    trackedBus,
  ]);

  const emphasizeRoutes = useMemo((): RouteRef[] => {
    if (tab === "plan") {
      return (selectedJourney?.legs ?? []).flatMap((leg) =>
        leg.kind === "ride"
          ? [
              {
                routeCode: leg.ride.route.code,
                directionId: leg.ride.direction_id,
              },
            ]
          : [],
      );
    }
    if (selectedBus || !activeRoute || !direction) return [];
    return [{ routeCode: activeRoute.code, directionId: direction }];
  }, [tab, selectedJourney, selectedBus, activeRoute, direction]);

  return {
    routeLock: tab === "routes" ? routeLock : null,
    buses: tab === "routes" ? routesTabBuses : planTabBusList,
    stops,
    emphasizeRoutes,
  };
}
