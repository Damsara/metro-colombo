import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePlaces, useRoutes, useStopCatalog } from "../api";
import type { Place, Route, Stop } from "../types";
import { routeColor } from "../lib/routeColor";

const EMPTY_ROUTES: Route[] = [];
const EMPTY_PLACES: Place[] = [];
const NO_STOPS: ReadonlyMap<string, Stop> = new Map();

// The reference data most of the app leans on: routes, every stop, landmarks
// and the lookups built from them. It changes rarely, unlike the live buses,
// which stay out of here so a position update doesn't re-render every reader.
function useTransitDataSource() {
  const routesQuery = useRoutes();
  const routes = routesQuery.data ?? EMPTY_ROUTES;
  const catalog = useStopCatalog(routes);
  const places = usePlaces().data ?? EMPTY_PLACES;
  const routeColors = useMemo(
    () =>
      new Map(
        routes.map((route) => [route.code, routeColor(route.color_hex)]),
      ),
    [routes],
  );
  const routeCodeById = useMemo(
    () => new Map(routes.map((route) => [route.id, route.code])),
    [routes],
  );
  // Stops keyed by lower-case English name, for translating place names.
  const stopsByName = useMemo(
    () =>
      new Map<string, Stop>(
        catalog.stops.map((stop) => [
          stop.stop_name_en.trim().toLowerCase(),
          stop,
        ]),
      ),
    [catalog.stops],
  );
  return useMemo(
    () => ({
      routesQuery,
      routes,
      catalog,
      places,
      routeColors,
      routeCodeById,
      stopsByName,
    }),
    [
      routesQuery,
      routes,
      catalog,
      places,
      routeColors,
      routeCodeById,
      stopsByName,
    ],
  );
}

export type TransitData = ReturnType<typeof useTransitDataSource>;

const TransitDataContext = createContext<TransitData | null>(null);

export function TransitDataProvider({ children }: { children: ReactNode }) {
  const value = useTransitDataSource();
  return (
    <TransitDataContext.Provider value={value}>
      {children}
    </TransitDataContext.Provider>
  );
}

export function useTransitData(): TransitData {
  const value = useContext(TransitDataContext);
  if (!value) {
    throw new Error("useTransitData must be used within a TransitDataProvider");
  }
  return value;
}

/** Stops by English name; empty outside the provider (e.g. in tests). */
export function useStopsByName(): ReadonlyMap<string, Stop> {
  return useContext(TransitDataContext)?.stopsByName ?? NO_STOPS;
}
