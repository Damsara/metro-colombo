import { useCallback, useMemo } from "react";
import { useLive } from "../api";
import type { LiveBus } from "../types";

export function useLiveBuses(routeCodeById: ReadonlyMap<string, string>) {
  const liveQuery = useLive();
  const buses = useMemo(
    () =>
      (liveQuery.data?.success ? liveQuery.data.buses : []).map((bus) =>
        bus.route_code || !bus.route_id
          ? bus
          : { ...bus, route_code: routeCodeById.get(bus.route_id) },
      ),
    [liveQuery.data, routeCodeById],
  );
  const unavailable = Boolean(
    liveQuery.isError || (liveQuery.data && !liveQuery.data.success),
  );
  const routeCodeOf = useCallback(
    (bus: LiveBus) =>
      bus.route_code ??
      (bus.route_id ? routeCodeById.get(bus.route_id) : undefined),
    [routeCodeById],
  );
  const liveCountByRoute = useMemo(() => {
    const counts = new Map<string, number>();
    for (const bus of buses) {
      if (!bus.route_code) continue;
      counts.set(bus.route_code, (counts.get(bus.route_code) ?? 0) + 1);
    }
    return counts;
  }, [buses]);
  return {
    buses,
    unavailable,
    loaded: liveQuery.data !== undefined,
    /** When the latest response arrived, on this device's clock. */
    receivedAt: liveQuery.dataUpdatedAt,
    /** The latest response's own timestamp, on the server's clock. */
    feedTimestamp: liveQuery.data?.timestamp,
    routeCodeOf,
    liveCountByRoute,
  };
}
