import { useCallback, useState } from "react";
import { resolveBusDirectionId, type Route } from "../types";

/** The route opened on the Bus routes tab, and which direction is showing. */
export function useRouteBrowser(routes: Route[]) {
  const [routeCode, setRouteCode] = useState<string | null>(null);
  const [directionIndex, setDirectionIndex] = useState(0);

  const open = useCallback((code: string) => {
    setRouteCode(code);
    setDirectionIndex(0);
  }, []);
  const close = useCallback(() => setRouteCode(null), []);

  // Open the route a bus is on, turned to the direction it's heading.
  const showRouteOf = useCallback(
    (code: string, busDirection: string | undefined) => {
      setRouteCode(code);
      const route = routes.find((item) => item.code === code);
      const directionId = resolveBusDirectionId(route, busDirection);
      const index = route?.directions.findIndex(
        (item) => item.id === directionId,
      );
      if (index !== undefined && index >= 0) setDirectionIndex(index);
    },
    [routes],
  );

  return {
    routeCode,
    directionIndex,
    open,
    close,
    changeDirection: setDirectionIndex,
    showRouteOf,
  };
}
