import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { distanceMeters, useJourney, type JourneyRequest } from "../api";
import { distanceLabel } from "../i18n";
import { useLanguage } from "../lib/language";
import {
  colomboDate,
  nextDay,
  stopName,
  type CatalogStop,
  type JourneyOption,
  type Stop,
} from "../types";
import { useSearchFlag } from "../useSearchFlag";

type LocationNote =
  | { kind: "nearest"; stop: CatalogStop; meters: number }
  | { kind: "unsupported" | "failed" }
  | null;

/**
 * The trip being planned: its two stops and date, the search and its
 * results page, and "use my location" for the starting stop.
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
  const journey = useJourney(request);

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
  const submit = () => {
    if (journey.isFetching) return;
    if (!from || !to || invalidSameStop) return;
    // A tab left open overnight still holds yesterday's date.
    const day = date < colomboDate() ? colomboDate() : date;
    setDate(day);
    setRequest({ from: from.id, to: to.id, date: day });
    setSelectedJourney(null);
    setTripOpen(true);
  };
  const searchNextDay = () => {
    if (!request) return;
    const next = nextDay(request.date);
    setDate(next);
    setRequest({ ...request, date: next });
    setSelectedJourney(null);
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setLocationNote({ kind: "unsupported" });
      return;
    }
    setLocationBusy(true);
    setLocationNote(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const here = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        const distance = (stop: Stop) => distanceMeters(here, stop);
        const nearest = stops.reduce<CatalogStop | null>(
          (best, stop) =>
            !best || distance(stop) < distance(best) ? stop : best,
          null,
        );
        if (nearest) {
          changeFrom(nearest);
          setLocationNote({
            kind: "nearest",
            stop: nearest,
            meters: distance(nearest),
          });
        }
        setLocationBusy(false);
      },
      () => {
        setLocationBusy(false);
        setLocationNote({ kind: "failed" });
      },
      { timeout: 12000, maximumAge: 60000 },
    );
  };

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
    searchNextDay,
    locationBusy,
    locationMessage,
    locate,
  };
}
