import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowRight,
  MapPin,
  Navigation,
  RotateCcw,
  Route as RouteIcon,
  Search,
} from "lucide-react";
import {
  lazy,
  Suspense,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useGeometry, useAllRouteGeometries, useRouteStops } from "./api";
import { track } from "./lib/analytics";
import { MAP_STATUS } from "./classNames";
import { AppHeader } from "./components/AppHeader";
import { PrivacyChoicesLink } from "./components/ConsentPrompt";
import { HowToUse } from "./components/HowToUse";
import JourneyResults, { journeyKey } from "./components/JourneyResults";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { MapLegend } from "./components/MapLegend";
import { PhoneDrawer } from "./components/PhoneDrawer";
import { RouteDetail, RouteList } from "./components/RoutesPanel";
import { StopCard } from "./components/StopCard";
import { TrackingPanel } from "./components/TrackingPanel";
import { TripForm } from "./components/TripForm";
import { TripSummary } from "./components/TripSummary";
import { Button, buttonClass } from "./components/ui/Button";
import { cardClass } from "./components/ui/Card";
import { Eyebrow } from "./components/ui/Eyebrow";
import { IconButton } from "./components/ui/IconButton";
import { Notice } from "./components/ui/Notice";
import { Tabs } from "./components/ui/Tabs";
import { intentSnap, snapHeights, type Snap } from "./lib/drawerSnap";
import { useLanguage } from "./lib/language";
import { findStop, type RecentStop } from "./lib/recentTrips";
import { sameStop } from "./lib/stopCard";
import { useMediaQuery } from "./lib/useMediaQuery";
import {
  useElementHeight,
  useSafeAreaBottom,
  useViewportHeight,
} from "./lib/useViewport";
import { TransitDataProvider, useTransitData } from "./state/TransitData";
import { useBusSelection } from "./state/useBusSelection";
import { useLiveBuses } from "./state/useLiveBuses";
import { useMapLayers } from "./state/useMapLayers";
import { useRouteBrowser } from "./state/useRouteBrowser";
import { useTracking } from "./state/useTracking";
import { useTrip } from "./state/useTrip";
import {
  busKey,
  type CatalogStop,
  type JourneyOption,
  type LiveBus,
  type Ride,
  type Stop,
} from "./types";

const FOOTER_LINK =
  "font-semibold underline underline-offset-2 hover-fine:text-ink";
import { stopName } from "./types";
const MapView = lazy(() => import("./components/MapView"));

const NO_BUSES: LiveBus[] = [];
const POPULAR_STOPS = ["makumbura", "colombo fort", "kottawa"];
// On phones the map controls climb above the tracked-bus pill sitting on the
// drawer, so it doesn't cover them.
const PILL_ROOM_PX = 92;
// The control column and the attribution under it, so the column stops short
// of the header.
const CONTROLS_PX = 210;
// Refreshes the tracked journey's live estimates.
const TRACK_REFRESH_MS = 60_000;

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
  // A stop opened from the keyboard moves focus to its card.
  const [stopFromKeyboard, setStopFromKeyboard] = useState(false);
  // Phones show the map full screen with everything else in a drawer over it.
  const phone = !useMediaQuery("(min-width: 761px)");
  const [snap, setSnap] = useState<Snap>("peek");
  const viewport = useViewportHeight();
  const safeBottom = useSafeAreaBottom();
  const headerRef = useRef<HTMLDivElement>(null);
  const headerHeight = useElementHeight(headerRef);
  const snapHeight = snapHeights(viewport, headerHeight, safeBottom);
  const drawerInset = phone ? snapHeight[snap] : 0;
  // The map keeps its framing and controls above half height at most, since
  // a full-height drawer hides it anyway.
  const mapInset = Math.min(drawerInset, snapHeight.half);

  // Old links to the phone's full-screen map open with the drawer at peek.
  const navigate = useNavigate({ from: "/" });
  const legacyMap = useSearch({ from: "/" }).map === 1;
  useEffect(() => {
    if (legacyMap)
      void navigate({ search: ({ map: _, ...rest }) => rest, replace: true });
  }, [legacyMap, navigate]);

  const trip = useTrip(catalog.stops);
  const live = useLiveBuses(routeCodeById);
  const selection = useBusSelection(live.buses, live.loaded);
  const browser = useRouteBrowser(routes);
  const { selectedJourney, request, journey, showResults } = trip;
  const { buses, routeCodeOf } = live;
  const { selectedBus, release: releaseBus } = selection;
  const tracking = useTracking({
    buses: live.unavailable ? NO_BUSES : buses,
    liveLoaded: live.loaded,
    receivedAt: live.receivedAt,
    feedTimestamp: live.feedTimestamp,
    plan: journey.data,
  });
  const trackingPlan = tab === "plan" && tracking.active;
  const trackedKey = tracking.bus ? busKey(tracking.bus) : null;
  // The tracked bus's identity lives in the panel, so the map's pill only
  // shows for some other bus picked on the map.
  const trackedSelected =
    tracking.active && !!selectedBus && busKey(selectedBus) === trackedKey;

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
      if (bus) track("follow_bus", { route: routeCodeOf(bus) ?? "unknown" });
      if (!bus || tab !== "routes") return;
      const code = routeCodeOf(bus);
      if (code) showRouteOf(code, bus.direction_id);
    },
    [selectBus, tab, routeCodeOf, showRouteOf],
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

  // While tracking, the map comes back to the tracked bus whenever nothing
  // else is picked, e.g. after it drops out of the feed for a moment.
  const trackedLive = tracking.liveBus;
  useEffect(() => {
    if (trackingPlan && trackedLive && !selection.selectedBusId)
      selectBus(trackedLive);
  }, [trackingPlan, trackedLive, selection.selectedBusId, selectBus]);
  // Ending tracking, by button or by Back, lets go of the bus.
  const wasTracking = useRef(false);
  useEffect(() => {
    if (wasTracking.current && !tracking.active) releaseBus();
    wasTracking.current = tracking.active;
  }, [tracking.active, releaseBus]);
  const refetchJourney = journey.refetch;
  useEffect(() => {
    if (!tracking.active) return;
    const interval = window.setInterval(
      () => void refetchJourney(),
      TRACK_REFRESH_MS,
    );
    return () => window.clearInterval(interval);
  }, [tracking.active, refetchJourney]);

  // Move the drawer to suit what the user just asked for.
  const viewJourney = selectedJourney ? journeyKey(selectedJourney) : null;
  const viewBus = selectedBus ? busKey(selectedBus) : null;
  const viewRoute = browser.routeCode;
  const viewStop = selectedStop?.id ?? null;
  const lastView = useRef({
    tab,
    showResults,
    journeyKey: viewJourney,
    busId: viewBus,
    routeCode: viewRoute,
    stopId: viewStop,
    tracking: trackingPlan,
  });
  useEffect(() => {
    const view = {
      tab,
      showResults,
      journeyKey: viewJourney,
      busId: viewBus,
      routeCode: viewRoute,
      stopId: viewStop,
      tracking: trackingPlan,
    };
    const previous = lastView.current;
    lastView.current = view;
    setSnap((current) => intentSnap(previous, view, current));
  }, [
    tab,
    showResults,
    viewJourney,
    viewBus,
    viewRoute,
    viewStop,
    trackingPlan,
  ]);

  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [showResults, tab, trackingPlan]);

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

  const selectedEntry = useMemo(
    () =>
      selectedStop
        ? catalog.stops.find((item) => item.ids.includes(selectedStop.id))
        : undefined,
    [catalog.stops, selectedStop],
  );
  // On phones the card takes over the drawer; closing it puts the drawer
  // back where it was.
  const snapBeforeStop = useRef<Snap | null>(null);
  const openStop = (stop: Stop, keyboard = false) => {
    if (!selectedStop) snapBeforeStop.current = snap;
    setSelectedStop(stop);
    setStopFromKeyboard(keyboard);
  };
  const closeStop = () => {
    setSelectedStop(null);
    if (snapBeforeStop.current) setSnap(snapBeforeStop.current);
    snapBeforeStop.current = null;
  };
  const changeSnap = (next: Snap) => {
    // Lowering the drawer to peek puts the stop's card away.
    if (next === "peek" && selectedStop) {
      setSelectedStop(null);
      snapBeforeStop.current = null;
    }
    setSnap(next);
  };
  const chooseStop = (stop: Stop, target: "from" | "to", search: boolean) => {
    const entry = selectedEntry ?? {
      ...stop,
      ids: [stop.id],
      routes: activeRoute ? [activeRoute.code] : [],
    };
    setSelectedStop(null);
    snapBeforeStop.current = null;
    setTab("plan");
    if (search && target === "to" && trip.from) {
      trip.searchFromStop(trip.from, entry);
      return;
    }
    if (search && target === "from" && trip.to) {
      trip.searchFromStop(entry, trip.to);
      return;
    }
    // A stop can't be both ends, so taking one end frees the other.
    if (target === "from") {
      trip.changeFrom(entry);
      if (trip.to && sameStop(stop, trip.to)) trip.changeTo(null);
    } else {
      trip.changeTo(entry);
      if (trip.from && sameStop(stop, trip.from)) trip.changeFrom(null);
    }
    // Bring the form up enough to show both stops and the search button.
    setSnap((current) => (current === "peek" ? "half" : current));
  };
  const selectTripJourney = trip.selectJourney;
  const selectJourney = useCallback(
    (option: JourneyOption | null) => {
      selectTripJourney(option);
      setSelectedStop(null);
      snapBeforeStop.current = null;
    },
    [selectTripJourney],
  );
  const startTracking = (option: JourneyOption, ride: Ride, bus: LiveBus) => {
    selectJourney(option);
    tracking.start(option, ride, bus);
    handleBusSelect(bus);
  };
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

  const controlsInset = !phone
    ? 0
    : Math.min(
        mapInset + (selectedBus && !trackedSelected ? PILL_ROOM_PX : 0),
        viewport - headerHeight - CONTROLS_PX,
      );

  const panelLabel = tab === "plan" ? t`Plan your bus trip` : t`Bus routes`;
  // On phones the panel scrolls only at full height; lower, a drag on it
  // moves the drawer.
  const panelScrolls = !phone || snap === "full";
  const formRef = useRef<HTMLDivElement>(null);
  // At peek a phone shows "Where to?" first, Uber-style; it opens the
  // form's own destination picker.
  const whereToBar = phone && snap === "peek" && tab === "plan" && !showResults;
  const stopCard = selectedStop && (
    <StopCard
      key={selectedStop.id}
      stop={selectedStop}
      entry={selectedEntry}
      language={language}
      routeColors={routeColors}
      from={trip.from}
      to={trip.to}
      inline={phone}
      focusHeading={stopFromKeyboard}
      onClose={closeStop}
      onChoose={(target, search) => chooseStop(selectedStop, target, search)}
    />
  );
  // On phones a selected stop's card stands in for the drawer's content,
  // which stays mounted underneath to come back as it was.
  const stopInDrawer = phone && !!selectedStop;
  const panel = (
    <>
      {stopInDrawer && (
        <div
          className={`min-h-0 flex-1 overscroll-contain ${
            panelScrolls ? "touch-pan-y overflow-y-auto" : "overflow-hidden"
          }`}
          data-vaul-no-drag={panelScrolls ? "" : undefined}
        >
          {stopCard}
        </div>
      )}
      {whereToBar && !stopInDrawer && (
        <div className="px-4 pb-2">
          <button
            type="button"
            className={`flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left ${cardClass()}`}
            onClick={() =>
              formRef.current
                ?.querySelector<HTMLInputElement>('[role="combobox"]')
                ?.focus({ preventScroll: true })
            }
          >
            <Search size={20} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-xl font-semibold tracking-tight">
                {t`Where to?`}
              </span>
              {toName && (
                <span className="block truncate text-sm text-muted">
                  {toName}
                </span>
              )}
            </span>
          </button>
        </div>
      )}
      <Tabs
        // While tracking, a phone's drawer keeps to the bus.
        className={`border-b border-line px-6 pt-4.5 pb-3.5 max-md:px-4 max-md:pt-0 max-md:pb-2 ${
          trackingPlan || stopInDrawer ? "max-md:hidden" : ""
        }`}
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
        hidden={stopInDrawer}
        className={`min-h-0 flex-1 overscroll-contain px-7.5 pt-7.5 pb-5 max-lg:px-6 max-lg:py-6 max-md:px-4 max-md:pt-3 max-md:pb-6 2xl:px-10 2xl:py-9 ${
          panelScrolls ? "touch-pan-y overflow-y-auto" : "overflow-hidden"
        }`}
        // At full height, a drag inside scrolls the panel instead.
        data-vaul-no-drag={phone && panelScrolls ? "" : undefined}
      >
        {trackingPlan ? (
          <div key="tracking">
            <TrackingPanel
              tracking={tracking}
              language={language}
              routeColors={routeColors}
              following={trackedSelected && selection.followBus}
              onFollow={() => {
                if (!tracking.liveBus) return;
                if (trackedSelected) selection.changeFollow(true);
                else handleBusSelect(tracking.liveBus);
              }}
              onStop={tracking.stop}
            />
          </div>
        ) : tab === "plan" && showResults && request ? (
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
              onTrack={startTracking}
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
            <h1 className="sr-only">{t`Where would you like to go?`}</h1>
            <div
              ref={formRef}
              // Picking a stop on a phone lifts the drawer to full height, under
              // the full-screen stop sheet.
              onFocusCapture={(event) => {
                if (phone && event.target.getAttribute("role") === "combobox")
                  setSnap("full");
              }}
            >
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
            </div>
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
                onStopSelect={(stop, keyboard) =>
                  stop ? openStop(stop, keyboard) : closeStop()
                }
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
              <Button variant="link" onClick={() => void routesQuery.refetch()}>
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
        {/* Phones keep the header to the logo and language; the API link lives here. */}
        <span className="md:hidden">
          <span aria-hidden="true"> · </span>
          <Link className={FOOTER_LINK} to="/docs">
            API
          </Link>
        </span>
        <PrivacyChoicesLink separated />
      </footer>
    </>
  );

  return (
    <>
      <div
        className="flex h-dvh flex-col max-md:overflow-hidden"
        style={
          {
            "--drawer-inset": `${drawerInset}px`,
            "--map-controls-inset": `${controlsInset}px`,
            "--header-height": `${headerHeight}px`,
          } as CSSProperties
        }
      >
        {/* On phones the header floats, frosted, over the map. */}
        <div
          ref={headerRef}
          className="relative z-40 max-md:absolute max-md:inset-x-0 max-md:top-0"
        >
          <AppHeader
            homeLabel={t`Metro home`}
            reloadHome
            className="max-md:border-line/70 max-md:bg-paper/80 max-md:backdrop-blur-md max-md:reduce-transparency:bg-paper max-md:reduce-transparency:backdrop-blur-none"
          >
            <div className="flex items-center gap-3">
              <Link
                className={`${buttonClass({
                  variant: "neutral",
                  size: "xs",
                  pill: true,
                })} max-md:hidden`}
                to="/docs"
              >
                API
              </Link>
              <LanguageSwitcher />
            </div>
          </AppHeader>
        </div>
        <main className="grid min-h-0 flex-1 grid-cols-[460px_minmax(0,1fr)] max-lg:grid-cols-[415px_minmax(0,1fr)] max-md:block 2xl:grid-cols-[490px_minmax(0,1fr)]">
          {phone ? (
            <PhoneDrawer
              label={panelLabel}
              snap={snap}
              heights={snapHeight}
              viewport={viewport}
              onSnapChange={changeSnap}
            >
              {panel}
            </PhoneDrawer>
          ) : (
            <section
              className="z-10 flex min-h-0 flex-col border-r border-line bg-paper"
              aria-label={panelLabel}
            >
              {panel}
            </section>
          )}
          <section
            className="relative min-h-0 overflow-hidden bg-map max-md:fixed max-md:inset-0 max-md:z-0"
            aria-label={t`Bus route map`}
          >
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
                showBusPill={!trackedSelected}
                language={language}
                onStopSelect={(stop) => (stop ? openStop(stop) : closeStop())}
                onBusSelect={handleBusSelect}
                onFollowChange={selection.changeFollow}
                showLive={selection.showLive}
                onShowLiveChange={handleShowLiveChange}
                insets={
                  phone ? { top: headerHeight, bottom: mapInset } : undefined
                }
              />
            </Suspense>
            <div
              className={`pointer-events-none absolute top-7.5 right-19 left-7.5 max-md:hidden ${
                selectedBus ? "hidden" : ""
              }`}
            >
              <div
                className={`inline-flex max-w-full flex-col gap-1 px-4.5 py-3 shadow-float ${cardClass()}`}
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
                className="absolute top-31 left-7.5 max-w-82 text-sm max-md:top-[calc(var(--header-height,60px)+8px)] max-md:right-3 max-md:left-3 max-md:max-w-none"
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
            {!phone && stopCard}
            {/* Phones keep the map clear; MapView still names the key for screen readers. */}
            <MapLegend showLive={selection.showLive} hidden={phone} />
          </section>
        </main>
      </div>
    </>
  );
}
