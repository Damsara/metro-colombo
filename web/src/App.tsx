import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Map as MapIcon,
  MapPin,
  Navigation,
  RotateCcw,
  Route as RouteIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useGeometry, useAllRouteGeometries, useRouteStops } from "./api";
import { MAP_STATUS } from "./classNames";
import { AppHeader } from "./components/AppHeader";
import { HowToUse } from "./components/HowToUse";
import JourneyResults from "./components/JourneyResults";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { MapLegend } from "./components/MapLegend";
import { RouteDetail, RouteList } from "./components/RoutesPanel";
import { StopCard } from "./components/StopCard";
import { TripForm } from "./components/TripForm";
import { TripSummary } from "./components/TripSummary";
import { Button, buttonClass } from "./components/ui/Button";
import { cardClass } from "./components/ui/Card";
import { Eyebrow } from "./components/ui/Eyebrow";
import { IconButton } from "./components/ui/IconButton";
import { Notice } from "./components/ui/Notice";
import { Tabs } from "./components/ui/Tabs";
import { useLanguage } from "./lib/language";
import { findStop, type RecentStop } from "./lib/recentTrips";
import { useMediaQuery } from "./lib/useMediaQuery";
import { TransitDataProvider, useTransitData } from "./state/TransitData";
import { useBusSelection } from "./state/useBusSelection";
import { useFullScreenMap } from "./state/useFullScreenMap";
import { useLiveBuses } from "./state/useLiveBuses";
import { useMapLayers } from "./state/useMapLayers";
import { useRouteBrowser } from "./state/useRouteBrowser";
import { useTrip } from "./state/useTrip";
import type { CatalogStop, JourneyOption, LiveBus, Stop } from "./types";

const FOOTER_LINK =
  "font-semibold underline underline-offset-2 hover-fine:text-ink";
import { stopName } from "./types";
import { useSearchFlag } from "./useSearchFlag";
const MapView = lazy(() => import("./components/MapView"));

const NO_BUSES: LiveBus[] = [];
const POPULAR_STOPS = ["makumbura", "colombo fort", "kottawa"];

export default function App() {
  return (
    <TransitDataProvider>
      <Home />
    </TransitDataProvider>
  );
}

function Home() {
  const { language } = useLanguage();
  const { t } = useLingui();
  const { routesQuery, routes, catalog, places, routeColors, routeCodeById } =
    useTransitData();
  const [tab, setTab] = useState<"plan" | "routes">("plan");
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [showMap, setShowMap] = useSearchFlag("map");
  const desktopMap = useMediaQuery("(min-width: 761px)");
  const mobileMapOpen = !desktopMap && showMap;
  const { openButtonRef: mapButtonRef, backButtonRef: mapBackRef } =
    useFullScreenMap(mobileMapOpen);

  const trip = useTrip(catalog.stops);
  const live = useLiveBuses(routeCodeById);
  const selection = useBusSelection(live.buses, live.loaded);
  const browser = useRouteBrowser(routes);
  const { selectedJourney, request, journey, showResults } = trip;
  const { buses, routeCodeOf } = live;
  const { selectedBus, release: releaseBus } = selection;

  // The Plan tab shows the selected journey's first ride; the Routes tab shows
  // the route the user opened.
  const firstRide = selectedJourney?.legs.find((leg) => leg.kind === "ride");
  const firstRideTrip = firstRide?.kind === "ride" ? firstRide.ride : undefined;
  const activeRouteCode =
    tab === "plan" ? firstRideTrip?.route.code : browser.routeCode;
  const activeRoute = routes.find((route) => route.code === activeRouteCode);
  const direction =
    tab === "plan"
      ? firstRideTrip?.direction_id
      : activeRoute?.directions[browser.directionIndex]?.id;
  const routeStops = useRouteStops(activeRoute?.code, direction);
  const geometry = useGeometry(activeRoute?.code, direction);
  const { mapRoutes: networkMapRoutes } = useAllRouteGeometries(routes);
  const mapLayers = useMapLayers({
    tab,
    routes,
    buses,
    selectedBus,
    routeCodeOf,
    activeRoute,
    direction,
    selectedJourney,
    routeStops: routeStops.data?.stops,
    allStops: catalog.stops,
  });

  // Picking a bus also opens the map on phones and, on the Bus routes tab,
  // the route it's on.
  const selectBus = selection.select;
  const showRouteOf = browser.showRouteOf;
  const handleBusSelect = useCallback(
    (bus: LiveBus | null) => {
      selectBus(bus);
      if (!bus) return;
      if (!desktopMap) setShowMap(true);
      if (tab !== "routes") return;
      const code = routeCodeOf(bus);
      if (code) showRouteOf(code, bus.direction_id);
    },
    [selectBus, desktopMap, setShowMap, tab, routeCodeOf, showRouteOf],
  );
  const setShowLive = selection.setShowLive;
  const handleShowLiveChange = useCallback(
    (show: boolean) => {
      setShowLive(show);
      if (!show) handleBusSelect(null);
    },
    [setShowLive, handleBusSelect],
  );
  useEffect(() => {
    if (tab === "plan") releaseBus();
  }, [tab, releaseBus]);

  useEffect(() => {
    if (!selectedStop) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedStop(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [selectedStop]);

  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [showResults, tab]);

  const fromName = trip.from ? stopName(trip.from, language) : "";
  const toName = trip.to ? stopName(trip.to, language) : "";
  const popularStops = useMemo(
    () =>
      POPULAR_STOPS.map((name) =>
        catalog.stops.find((stop) => stop.stop_name_en.toLowerCase() === name),
      ).filter((stop): stop is CatalogStop => !!stop),
    [catalog.stops],
  );

  const stopSections = useMemo(
    () => [
      { key: "recent", title: t`Recent`, stops: trip.recentStops },
      { key: "nearby", title: t`Near you`, stops: trip.nearbyStops },
      { key: "popular", title: t`Popular`, stops: popularStops },
    ],
    [t, trip.recentStops, trip.nearbyStops, popularStops],
  );
  // The catalog's name in the current language, or the remembered one.
  const recentName = (stop: RecentStop) => {
    const entry = findStop(catalog.stops, stop);
    return entry ? stopName(entry, language) : stop.name;
  };

  const chooseStop = (stop: Stop, target: "from" | "to") => {
    const entry = catalog.stops.find((item) => item.ids.includes(stop.id)) ?? {
      ...stop,
      ids: [stop.id],
      routes: activeRoute ? [activeRoute.code] : [],
    };
    if (target === "from") trip.changeFrom(entry);
    else trip.changeTo(entry);
    setSelectedStop(null);
    setTab("plan");
    setShowMap(false);
  };
  const selectTripJourney = trip.selectJourney;
  const selectJourney = useCallback(
    (option: JourneyOption | null) => {
      selectTripJourney(option);
      setSelectedStop(null);
    },
    [selectTripJourney],
  );
  const changeTab = (next: "plan" | "routes") => {
    setTab(next);
    setSelectedStop(null);
  };
  const openRoute = (code: string) => {
    browser.open(code);
    releaseBus();
  };
  const changeDirection = (index: number) => {
    browser.changeDirection(index);
    setSelectedStop(null);
    releaseBus();
  };
  const closeRoute = () => {
    browser.close();
    setSelectedStop(null);
    releaseBus();
  };

  return (
    <>
      <div
        className={`flex h-dvh flex-col ${showMap ? "max-md:overflow-hidden" : ""}`}
      >
        <AppHeader
          homeLabel={t`Metro home`}
          reloadHome
          className={showMap ? "max-md:hidden" : ""}
        >
          <div className="flex items-center gap-3">
            <Link
              className={buttonClass({
                variant: "neutral",
                size: "xs",
                pill: true,
              })}
              to="/docs"
            >
              API
            </Link>
            <LanguageSwitcher />
          </div>
        </AppHeader>
        <main
          className={`grid min-h-0 flex-1 grid-cols-[460px_minmax(0,1fr)] max-lg:grid-cols-[415px_minmax(0,1fr)] max-md:relative max-md:block 2xl:grid-cols-[490px_minmax(0,1fr)] ${showMap ? "max-md:h-dvh max-md:min-h-dvh" : ""}`}
        >
          <section
            className={`z-10 flex min-h-0 flex-col border-r border-line bg-paper max-md:h-full max-md:border-r-0 ${showMap ? "max-md:hidden" : ""}`}
            aria-label={tab === "plan" ? t`Plan your bus trip` : t`Bus routes`}
          >
            <Tabs
              className="border-b border-line px-6 pt-4.5 pb-3.5 max-md:px-4.5 max-md:pt-3 max-md:pb-3"
              label={t`Explore Metro`}
              value={tab}
              onChange={changeTab}
              tabs={[
                {
                  value: "plan",
                  icon: <Navigation size={19} />,
                  label: t`Plan a trip`,
                },
                {
                  value: "routes",
                  icon: <RouteIcon size={20} />,
                  label: t({ message: "Bus routes", context: "tab" }),
                },
              ]}
            />
            <div
              ref={panelRef}
              className="flex-1 overflow-y-auto overscroll-contain px-7.5 pt-7.5 pb-5 max-lg:px-6 max-lg:py-6 max-md:px-6 max-md:pt-7 max-md:pb-6 2xl:px-10 2xl:py-9"
            >
              {tab === "plan" && showResults && request ? (
                <div key="trip" className="motion-safe:animate-page-forward">
                  <TripSummary
                    fromName={fromName}
                    toName={toName}
                    date={request.date}
                    onEdit={() => trip.setTripOpen(false)}
                  />
                  <JourneyResults
                    plan={journey.data}
                    loading={journey.isFetching}
                    error={journey.error}
                    language={language}
                    selected={selectedJourney}
                    onSelect={selectJourney}
                    routeColors={routeColors}
                    liveBuses={live.unavailable ? NO_BUSES : buses}
                    onShowBus={handleBusSelect}
                    onRetry={() => void journey.refetch()}
                    onNextDay={trip.searchNextDay}
                  />
                </div>
              ) : tab === "plan" ? (
                <div
                  key="form"
                  // Coming back from the results page slides the form in from the left.
                  className={request ? "motion-safe:animate-page-back" : ""}
                >
                  <div className="pb-6">
                    <h1 className="mt-3 mb-3 text-5xl leading-tight font-semibold tracking-tight whitespace-pre-line max-md:text-4xl">
                      {t`Where would you
like to go?`}
                    </h1>
                    <p className="text-base leading-relaxed text-muted max-md:text-md">
                      {t`Choose two stops. We’ll help with the rest.`}
                    </p>
                  </div>
                  <TripForm
                    from={trip.from}
                    to={trip.to}
                    date={trip.date}
                    onFromChange={trip.changeFrom}
                    onToChange={trip.changeTo}
                    onSwap={trip.swap}
                    onDateChange={trip.changeDate}
                    onSubmit={trip.submit}
                    searching={journey.isFetching}
                    invalidSameStop={trip.invalidSameStop}
                    stops={catalog.stops}
                    stopsLoading={catalog.loading || routesQuery.isPending}
                    places={places}
                    routeColors={routeColors}
                    language={language}
                    locationBusy={trip.locationBusy}
                    locationMessage={trip.locationMessage}
                    onLocate={trip.locate}
                    fromIsNearest={trip.fromIsNearest}
                    stopSections={stopSections}
                  />
                  {trip.recentTrips.length > 0 && (
                    <div className="mt-7 max-md:mt-6">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-muted">
                          {t`Recent trips`}
                        </h2>
                        <Button variant="quiet" onClick={trip.clearRecent}>
                          {t({ message: "Clear", context: "recent trips" })}
                        </Button>
                      </div>
                      <ul className="divide-y divide-line">
                        {trip.recentTrips.map((recent) => {
                          const start = recentName(recent.from);
                          const end = recentName(recent.to);
                          // Rows wait for the stop catalog to find their stops.
                          const ready =
                            !!findStop(catalog.stops, recent.from) &&
                            !!findStop(catalog.stops, recent.to);
                          return (
                            <li
                              key={`${recent.from.code}-${recent.to.code}`}
                              className="flex items-center gap-1"
                            >
                              <button
                                type="button"
                                className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-base font-semibold text-ink disabled:opacity-50 hover-fine:bg-tint-50"
                                aria-label={t`Find buses from ${start} to ${end}`}
                                disabled={!ready}
                                onClick={() => trip.searchRecent(recent)}
                              >
                                <span className="truncate">{start}</span>
                                <ArrowRight
                                  size={16}
                                  className="shrink-0 text-muted"
                                  aria-hidden="true"
                                />
                                <span className="truncate">{end}</span>
                              </button>
                              <IconButton
                                variant="plain"
                                label={t`Find buses for the way back, from ${end} to ${start}`}
                                disabled={!ready}
                                onClick={() => trip.searchRecent(recent, true)}
                              >
                                <RotateCcw size={17} aria-hidden="true" />
                              </IconButton>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {!request && popularStops.length > 0 && (
                    <div className="mt-7 max-md:mt-6">
                      <h2 className="mb-2.5 text-sm font-semibold text-muted">
                        {t`Popular starting stops`}
                      </h2>
                      <div className="flex flex-wrap gap-2">
                        {popularStops.map((stop) => (
                          <Button
                            variant="neutral"
                            size="sm"
                            key={stop.id}
                            onClick={() => trip.changeFrom(stop)}
                          >
                            <MapPin size={14} />
                            {stopName(stop, language)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {request && !showResults && (
                    <Button
                      size="sm"
                      block
                      className="mt-4"
                      onClick={() => trip.setTripOpen(true)}
                    >
                      {t`Show the buses for this trip`}
                      <ArrowRight size={18} />
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <p
                    className="mb-4 text-sm leading-relaxed text-muted"
                    hidden={!!activeRoute}
                  >
                    {t`Open a route to see its stops and where its buses are now.`}
                  </p>
                  {routesQuery.isPending && (
                    <p role="status">{t`Loading bus routes…`}</p>
                  )}
                  {!activeRoute ? (
                    <RouteList
                      routes={routes}
                      stops={catalog.stops}
                      liveCountByRoute={live.liveCountByRoute}
                      onOpen={(route) => openRoute(route.code)}
                    />
                  ) : (
                    <RouteDetail
                      route={activeRoute}
                      directionIndex={browser.directionIndex}
                      onDirectionChange={changeDirection}
                      stops={routeStops.data?.stops}
                      stopsPending={routeStops.isPending}
                      stopsError={routeStops.isError}
                      onRetryStops={() => void routeStops.refetch()}
                      buses={buses}
                      liveUnavailable={live.unavailable}
                      selectedBusId={selection.selectedBusId}
                      onBusSelect={handleBusSelect}
                      selectedStopId={selectedStop?.id}
                      onStopSelect={setSelectedStop}
                      onBack={closeRoute}
                      language={language}
                    />
                  )}
                </>
              )}
              {routesQuery.isError && (
                <Notice
                  tone="danger"
                  role="alert"
                  className="my-4"
                  action={
                    <Button
                      variant="link"
                      onClick={() => void routesQuery.refetch()}
                    >
                      {t`Try again`}
                    </Button>
                  }
                >
                  {t`We can’t connect to Metro right now.`}
                </Notice>
              )}
              {!!catalog.errors.length && (
                <Notice
                  tone="danger"
                  role="status"
                  className="my-4"
                  action={
                    <Button variant="link" onClick={catalog.refetch}>
                      {t`Load missing stops`}
                    </Button>
                  }
                >
                  {t`Some stops couldn’t be loaded. Search may be incomplete.`}
                </Notice>
              )}
              <HowToUse hidden={tab === "plan" && showResults} />
            </div>
            {/* Phones show the map on demand, full screen. */}
            <div className="mx-6 mt-2 mb-3 hidden max-md:block">
              <Button
                size="sm"
                block
                ref={mapButtonRef}
                onClick={() => setShowMap(true)}
              >
                <MapIcon size={19} />
                {t`See the map`}
              </Button>
            </div>
            <footer className="min-h-11 border-t border-line px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] text-center text-2xs leading-normal text-muted">
              <Trans>
                Not affiliated with{" "}
                <a className={FOOTER_LINK} href="https://lankametro.lk">
                  Lanka Metro Transit
                </a>{" "}
                or the official{" "}
                <a className={FOOTER_LINK} href="https://lmtgo.eimsky.com">
                  LMT GO app
                </a>
                .
              </Trans>
            </footer>
          </section>
          <section
            className={`relative min-h-0 overflow-hidden bg-map max-md:absolute max-md:inset-0 max-md:z-30 max-md:h-full ${showMap ? "max-md:block" : "max-md:hidden"} ${
              // Hook for the MapLibre control overrides in styles.css.
              mobileMapOpen ? "map-panel--immersive" : ""
            }`}
            aria-label={t`Bus route map`}
          >
            {(desktopMap || showMap) && (
              <Suspense
                fallback={
                  <p className={MAP_STATUS} role="status">
                    {t`Loading map…`}
                  </p>
                }
              >
                <MapView
                  routes={networkMapRoutes}
                  routeCatalog={routes}
                  routeLock={mapLayers.routeLock}
                  emphasizeRoutes={mapLayers.emphasizeRoutes}
                  stops={mapLayers.stops}
                  buses={mapLayers.buses}
                  from={tab === "plan" ? trip.from : null}
                  to={tab === "plan" ? trip.to : null}
                  selectedStop={selectedStop}
                  selectedJourney={tab === "plan" ? selectedJourney : null}
                  selectedBus={selectedBus}
                  followBus={selection.followBus}
                  language={language}
                  onStopSelect={setSelectedStop}
                  onBusSelect={handleBusSelect}
                  onFollowChange={selection.changeFollow}
                  showLive={selection.showLive}
                  onShowLiveChange={handleShowLiveChange}
                  immersive={mobileMapOpen}
                />
              </Suspense>
            )}
            <div
              className={
                mobileMapOpen
                  ? "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2.5 bg-linear-to-b from-paper/95 via-paper/90 via-70% to-transparent px-3 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5 [&>*]:pointer-events-auto"
                  : "hidden"
              }
            >
              <button
                type="button"
                className={
                  mobileMapOpen
                    ? `${buttonClass({ variant: "neutral", size: "sm", pill: true })} shadow-float`
                    : "flex"
                }
                ref={mapBackRef}
                onClick={() => setShowMap(false)}
              >
                <ArrowLeft size={19} />
                {t`Back to my trip`}
              </button>
            </div>
            <div
              className={`pointer-events-none absolute top-7.5 right-19 left-7.5 max-md:top-4 max-md:right-16 max-md:left-4 ${
                mobileMapOpen || selectedBus ? "hidden" : ""
              }`}
            >
              <div
                className={`inline-flex max-w-full flex-col gap-1 px-4.5 py-3 shadow-float max-md:hidden ${cardClass()}`}
              >
                <Eyebrow>{t`Colombo & beyond`}</Eyebrow>
                <strong className="text-2xl font-semibold tracking-tight">
                  {activeRoute ? activeRoute.name : t`Find your way around.`}
                </strong>
              </div>
            </div>
            {geometry.isError && (
              <Notice
                tone="warning"
                className={`absolute text-sm ${
                  mobileMapOpen
                    ? "top-[calc(56px+env(safe-area-inset-top))] right-16 left-3"
                    : "top-31 left-7.5 max-w-82 max-md:top-20 max-md:right-16 max-md:left-4 max-md:max-w-none"
                }`}
                action={
                  <Button
                    variant="link"
                    onClick={() => void geometry.refetch()}
                  >
                    {t`Retry map route`}
                  </Button>
                }
              >
                {t`Route line unavailable. Stops and trip planning still work.`}
              </Notice>
            )}
            {selectedStop && (
              <StopCard
                stop={selectedStop}
                language={language}
                placement="map"
                immersive={mobileMapOpen}
                onClose={() => setSelectedStop(null)}
                onChoose={(target) => chooseStop(selectedStop, target)}
              />
            )}
            <MapLegend showLive={selection.showLive} hidden={mobileMapOpen} />
          </section>
        </main>
        {selectedStop && !showMap && (
          <StopCard
            stop={selectedStop}
            language={language}
            placement="panel"
            onClose={() => setSelectedStop(null)}
            onChoose={(target) => chooseStop(selectedStop, target)}
          />
        )}
      </div>
    </>
  );
}
