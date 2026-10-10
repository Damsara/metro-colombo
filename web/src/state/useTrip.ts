import { useLingui } from "@lingui/react/macro";
import { daysAhead, track } from "../lib/analytics";
import { useEffect, useMemo, useRef, useState } from "react";
import { distanceMeters, useJourney, type JourneyRequest } from "../api";
import { distanceLabel } from "../i18n";
import { useLanguage } from "../lib/language";
import {
  addRecentTrip,
  clearRecentTrips,
  findStop,
  loadRecentTrips,
  recentStop,
  recentStops,
  saveRecentTrips,
  type RecentTrip,
} from "../lib/recentTrips";
import {
  colomboDate,
  nextDay,
  stopName,
  type CatalogStop,
  type JourneyOption,
} from "../types";
import { useSearchFlag } from "../useSearchFlag";

type LocationNote =
  | { kind: "nearest"; stop: CatalogStop; meters: number }
  | { kind: "unsupported" | "failed" }
  | null;

type Position = { latitude: number; longitude: number };

const NEARBY_COUNT = 3;

/** True only when location is already allowed, so asking won't prompt. */
async function locationGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" });
    return status?.state === "granted";
  } catch {
    return false;
  }
}

/**
 * The trip being planned: its two stops and date, the search and its
 * results page, "use my location" for the starting stop and the recent
 * trips.
 */
export function useTrip(stops: CatalogStop[]) {
  const { t, i18n } = useLingui();
  const { language } = useLanguage();
  const [from, setFrom] = useState<CatalogStop | null>(null);
  const [to, setTo] = useState<CatalogStop | null>(null);
  const [date, setDate] = useState(colomboDate);
  const [request, setRequest] = useState<JourneyRequest | null>(null);
  const [selectedJourney, setSelectedJourney] = useState<JourneyOption | null>(
    null,
  );
  const [tripOpen, setTripOpen] = useSearchFlag("trip");
  const [locationBusy, setLocationBusy] = useState(false);
  // Kept as data so the message follows a language change.
  const [locationNote, setLocationNote] = useState<LocationNote>(null);
  const [here, setHere] = useState<Position | null>(null);
  const [recentTrips, setRecentTrips] = useState(() => loadRecentTrips());
  const journey = useJourney(request);
  // One results event per search, not per refetch.
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const plan = journey.data;
    if (!plan || !request) return;
    const key = `${request.from}:${request.to}:${request.date}`;
    if (reported.current === key) return;
    reported.current = key;
    track("trip_results", {
      options: plan.options.length,
      days_ahead: daysAhead(request.date, colomboDate()),
    });
  }, [journey.data, request]);
  // Read when a location lookup finishes, after the closure that started it.
  const latest = useRef({ from, stops });
  useEffect(() => {
    latest.current = { from, stops };
  });

  // The results page needs a search; a reload or a cleared search returns
  // to the form.
  const showResults = tripOpen && request !== null;
  useEffect(() => {
    if (tripOpen && !request) setTripOpen(false);
  }, [tripOpen, request, setTripOpen]);

  const clearJourney = () => {
    setRequest(null);
    setSelectedJourney(null);
  };
  const changeFrom = (stop: CatalogStop | null) => {
    setFrom(stop);
    clearJourney();
    setLocationNote(null);
  };
  const changeTo = (stop: CatalogStop | null) => {
    setTo(stop);
    clearJourney();
  };
  const swap = () => {
    setFrom(to);
    setTo(from);
    clearJourney();
    setLocationNote(null);
  };
  const changeDate = (next: string) => {
    setDate(next);
    clearJourney();
  };

  const invalidSameStop = !!from && from.id === to?.id;
  const search = (
    start: CatalogStop | null,
    end: CatalogStop | null,
    source: "form" | "recent" | "return" | "stop" = "form",
  ) => {
    if (journey.isFetching) return;
    if (!start || !end || start.id === end.id) return;
    // A tab left open overnight still holds yesterday's date.
    const day = date < colomboDate() ? colomboDate() : date;
    if (start.id !== from?.id) setLocationNote(null);
    setFrom(start);
    setTo(end);
    setDate(day);
    setRequest({ from: start.id, to: end.id, date: day });
    setSelectedJourney(null);
    setTripOpen(true);
    track("search_trip", {
      from_stop: start.stop_code,
      to_stop: end.stop_code,
      days_ahead: daysAhead(day, colomboDate()),
      source,
    });
    const trips = addRecentTrip(recentTrips, {
      from: recentStop(start),
      to: recentStop(end),
    });
    setRecentTrips(trips);
    saveRecentTrips(trips);
  };
  const submit = () => search(from, to);
  /** Searches straight away, for a trip finished from a stop's card. */
  const searchFromStop = (start: CatalogStop, end: CatalogStop) =>
    search(start, end, "stop");
  /** Runs a remembered trip, or its way back when `reverse` is set. */
  const searchRecent = (trip: RecentTrip, reverse = false) => {
    const start = findStop(stops, reverse ? trip.to : trip.from);
    const end = findStop(stops, reverse ? trip.from : trip.to);
    search(start ?? null, end ?? null, reverse ? "return" : "recent");
  };
  const clearRecent = () => {
    setRecentTrips([]);
    clearRecentTrips();
  };
  const searchNextDay = () => {
    if (!request) return;
    const next = nextDay(request.date);
    track("search_next_day", { days_ahead: daysAhead(next, colomboDate()) });
    setDate(next);
    setRequest({ ...request, date: next });
    setSelectedJourney(null);
  };

  const nearestTo = (position: Position, list: CatalogStop[]) =>
    list.reduce<{ stop: CatalogStop; meters: number } | null>((best, stop) => {
      const meters = distanceMeters(position, stop);
      return !best || meters < best.meters ? { stop, meters } : best;
    }, null);

  const locate = () => {
    if (!navigator.geolocation) {
      setLocationNote({ kind: "unsupported" });
      track("use_location", { result: "unsupported" });
      return;
    }
    setLocationBusy(true);
    setLocationNote(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setHere(point);
        const nearest = nearestTo(point, latest.current.stops);
        if (nearest) {
          changeFrom(nearest.stop);
          setLocationNote({ kind: "nearest", ...nearest });
        }
        setLocationBusy(false);
        track("use_location", { result: "found" });
      },
      () => {
        setLocationBusy(false);
        setLocationNote({ kind: "failed" });
        track("use_location", { result: "failed" });
      },
      { timeout: 12000, maximumAge: 60000 },
    );
  };

  // With location already allowed, start from the nearest stop without
  // being asked. Never prompts, and never replaces a stop the user chose.
  const autoLocated = useRef(false);
  const hasStops = stops.length > 0;
  useEffect(() => {
    if (autoLocated.current || !hasStops || !navigator.geolocation) return;
    autoLocated.current = true;
    void locationGranted().then((granted) => {
      if (!granted) return;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const point = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          setHere(point);
          if (latest.current.from) return;
          const nearest = nearestTo(point, latest.current.stops);
          if (!nearest) return;
          setFrom(nearest.stop);
          setLocationNote({ kind: "nearest", ...nearest });
        },
        () => {},
        { timeout: 12000, maximumAge: 60000 },
      );
    });
  }, [hasStops]);

  const nearbyStops = useMemo(
    () =>
      here
        ? stops
            .map((stop) => ({ stop, meters: distanceMeters(here, stop) }))
            .sort((a, b) => a.meters - b.meters)
            .slice(0, NEARBY_COUNT)
            .map(({ stop }) => stop)
        : [],
    [here, stops],
  );
  const recentStopList = useMemo(
    () => recentStops(recentTrips, stops),
    [recentTrips, stops],
  );
  const fromIsNearest =
    locationNote?.kind === "nearest" && locationNote.stop.id === from?.id;

  const nearestName =
    locationNote?.kind === "nearest"
      ? stopName(locationNote.stop, language)
      : "";
  const nearestDistance =
    locationNote?.kind === "nearest"
      ? distanceLabel(i18n, locationNote.meters)
      : "";
  const locationMessages = {
    nearest: t`Closest stop: ${nearestName} · ${nearestDistance} away in a straight line. Check your walking route.`,
    unsupported: t`Your browser cannot find your location. Please choose a stop.`,
    failed: t`Location was not available. You can still type your starting stop.`,
  };
  const locationMessage = locationNote
    ? locationMessages[locationNote.kind]
    : "";

  return {
    from,
    to,
    date,
    request,
    journey,
    selectedJourney,
    selectJourney: setSelectedJourney,
    invalidSameStop,
    tripOpen,
    setTripOpen,
    showResults,
    changeFrom,
    changeTo,
    swap,
    changeDate,
    submit,
    searchFromStop,
    searchNextDay,
    locationBusy,
    locationMessage,
    locate,
    fromIsNearest,
    nearbyStops,
    recentTrips,
    recentStops: recentStopList,
    searchRecent,
    clearRecent,
  };
}
