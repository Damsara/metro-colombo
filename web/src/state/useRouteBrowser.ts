import { useCallback, useEffect, useState } from "react";
import { resolveBusDirectionId, type Route } from "../types";
import { track } from "../lib/analytics";
import { useSearchFlag } from "../useSearchFlag";

export function useRouteBrowser(routes: Route[]) {
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [directionIndex, setDirectionIndex] = useState(0);
  // In the URL, so the Back button returns from a route to the list.
  const [detailOpen, setDetailOpen] = useSearchFlag("route");
  const routeCode = detailOpen ? openCode : null;

  // A reload forgets which route was open, so it shows the list.
  useEffect(() => {
    if (detailOpen && !openCode) setDetailOpen(false);
  }, [detailOpen, openCode, setDetailOpen]);

  const open = useCallback(
    (code: string) => {
      setOpenCode(code);
      setDirectionIndex(0);
      setDetailOpen(true);
      track("open_route", { route: code });
    },
    [setDetailOpen],
  );
  const close = useCallback(() => setDetailOpen(false), [setDetailOpen]);

  const showRouteOf = useCallback(
    (code: string, busDirection: string | undefined) => {
      setOpenCode(code);
      setDetailOpen(true);
      const route = routes.find((item) => item.code === code);
      const directionId = resolveBusDirectionId(route, busDirection);
      const index = route?.directions.findIndex(
        (item) => item.id === directionId,
      );
      if (index !== undefined && index >= 0) setDirectionIndex(index);
    },
    [routes, setDetailOpen],
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
