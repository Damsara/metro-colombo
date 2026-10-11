import {
  busDirection,
  busKey,
  type JourneyOption,
  type LiveBus,
  type Route,
} from "../types";

interface PlanBusInputs {
  buses: LiveBus[];
  routes: Route[];
  routeCodeOf: (bus: LiveBus) => string | undefined;
  journeys: readonly JourneyOption[] | null;
  keep: readonly (LiveBus | null | undefined)[];
}

export function planTabBuses({
  buses,
  routes,
  routeCodeOf,
  journeys,
  keep,
}: PlanBusInputs): LiveBus[] {
  if (!journeys) return buses;

  const directionsByRoute = new Map<string, Set<string>>();
  for (const option of journeys) {
    for (const leg of option.legs) {
      if (leg.kind !== "ride") continue;
      const code = leg.ride.route.code;
      const set = directionsByRoute.get(code) ?? new Set<string>();
      set.add(leg.ride.direction_id);
      directionsByRoute.set(code, set);
    }
  }

  const keptKeys = new Set(
    keep.flatMap((bus) => (bus ? [busKey(bus)] : [])).filter(Boolean),
  );
  const routeByCode = new Map(routes.map((route) => [route.code, route]));

  return buses.filter((bus) => {
    const key = busKey(bus);
    if (key && keptKeys.has(key)) return true;
    const code = routeCodeOf(bus);
    const wanted = code ? directionsByRoute.get(code) : undefined;
    if (!code || !wanted) return false;
    const direction = busDirection(routeByCode.get(code), bus.direction_id);
    return !direction || wanted.has(direction.id);
  });
}
