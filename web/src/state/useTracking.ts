import { useCallback, useEffect, useMemo, useState } from "react";
import { track } from "../lib/analytics";
import { useRouteStops } from "../api";
import {
  advancePhase,
  busReassignment,
  decodeTrackedRide,
  decodeTripRequest,
  encodeTrackedRide,
  resumeTracking,
  savedRide,
  busPosition,
  isLost,
  nextLastSeen,
  trackedFix,
  refreshedRide,
  rideIndexes,
  stopsUntil,
  trackingPhase,
  type TrackingPhase,
} from "../lib/tracking";
import {
  busKey,
  findLiveBus,
  type JourneyOption,
  type JourneyPlan,
  type LiveBus,
  type Ride,
} from "../types";
import { useSearchFlag } from "../useSearchFlag";
import { useSearchParam } from "../useSearchParam";

const MILESTONE = {
  headOut: "head_out",
  nextStop: "next_stop",
  arrived: "arrived",
} as const;

// Often enough to notice a bus gone quiet soon after the minute is up.
const CLOCK_TICK_MS = 5_000;

interface Target {
  key: string;
  option: JourneyOption;
  ride: Ride;
  /** The bus as last seen, for its plate and route while it isn't reporting. */
  bus: LiveBus;
}

export interface Reassignment {
  from: string;
  to: string;
}

/** Phases worth telling a screen reader about, once each. */
export type Announcement = "headOut" | "nextStop" | "arrived" | "lost";

/**
 * Tracking one journey's bus from "it's coming" through boarding to the stop
 * you get off at. In the URL (`?track=1`) so the Back button ends it.
 */
export function useTracking({
  buses,
  liveLoaded,
  receivedAt,
  feedTimestamp,
  plan,
}: {
  buses: readonly LiveBus[];
  liveLoaded: boolean;
  /** When the latest live feed arrived. */
  receivedAt: number;
  /** The latest live feed's own timestamp. */
  feedTimestamp?: number;
  plan: JourneyPlan | undefined;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [on, setOn] = useSearchFlag("track");
  const [searchRide, setSearchRide] = useSearchParam("ride");
  const [searchRequest] = useSearchParam("journey");
  const saved = useMemo(() => decodeTrackedRide(searchRide), [searchRide]);
  const key = saved
    ? `${searchRequest}|${encodeTrackedRide({ ...saved, plate: "" })}`
    : "";
  const active = on && target !== null && target.key === key;

  useEffect(() => {
    if (!on || active) return;
    const request = decodeTripRequest(searchRequest);
    if (!saved || !request) {
      setOn(false);
      return;
    }
    if (!plan || !liveLoaded) return;
    if (
      plan.from_stop.id !== request.from ||
      plan.to_stop.id !== request.to ||
      plan.date !== request.date
    )
      return;
    const restored = resumeTracking(plan, saved, buses);
    if (restored) setTarget({ ...restored, key });
    else setOn(false);
  }, [on, active, saved, searchRequest, plan, liveLoaded, buses, key, setOn]);

  const start = useCallback(
    async (option: JourneyOption, ride: Ride, bus: LiveBus) => {
      const saved = savedRide(
        ride,
        bus.registration_number ?? ride.bus?.registration_number ?? "",
      );
      await setSearchRide(encodeTrackedRide(saved));
      setTarget({
        option,
        ride,
        bus,
        key: `${searchRequest}|${encodeTrackedRide({ ...saved, plate: "" })}`,
      });
      setOn(true);
      track("track_bus_start", { route: ride.route.code });
    },
    [setOn, setSearchRide, searchRequest],
  );
  const stop = useCallback(() => setOn(false), [setOn]);

  // A refreshed plan carries newer estimates for the same ride.
  const ride = useMemo(
    () => target && refreshedRide(plan, target.ride, target.bus),
    [plan, target],
  );

  const liveBus =
    active && target
      ? ride?.bus
        ? findLiveBus(buses, ride.bus)
        : buses.find((bus) => busKey(bus) === busKey(target.bus))
      : undefined;
  // While the bus is out of the feed, its last fix stands in, not where it
  // was when tracking began.
  const [lastLive, setLastLive] = useState<LiveBus | null>(null);
  const bus = trackedFix(liveBus, lastLive, target?.bus);

  const [phase, setPhase] = useState<TrackingPhase>("waiting");
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [now, setNow] = useState(Date.now);
  const [lastSeen, setLastSeen] = useState(Date.now);
  useEffect(() => {
    setLastLive(null);
    if (!active) return;
    // Tracking starts with a full grace period.
    setLastSeen(Date.now());
    const interval = window.setInterval(
      () => setNow(Date.now()),
      CLOCK_TICK_MS,
    );
    return () => window.clearInterval(interval);
  }, [active, target]);
  // Every feed the bus is in moves "last seen" up to its fix's time, so a
  // fix that stops changing still runs out.
  useEffect(() => {
    if (!liveBus) return;
    setLastLive(liveBus);
    setLastSeen((previous) =>
      nextLastSeen(previous, liveBus, receivedAt, feedTimestamp),
    );
    setNow(Date.now());
  }, [liveBus, receivedAt, feedTimestamp]);
  const missing = active && liveLoaded && isLost(lastSeen, now);
  const reassigned: Reassignment | null = active
    ? busReassignment(
        saved?.plate,
        ride?.bus?.registration_number ?? liveBus?.registration_number,
      )
    : null;
  const acknowledgeReassigned = useCallback(() => {
    if (saved && reassigned)
      void setSearchRide(encodeTrackedRide({ ...saved, plate: reassigned.to }));
  }, [saved, reassigned, setSearchRide]);

  const stops = useRouteStops(
    active ? ride?.route.code : undefined,
    ride?.direction_id,
  ).data?.stops;
  const position = stops && bus ? busPosition(bus, stops) : null;
  const { board: boardIndex, alight: alightIndex } =
    stops && ride
      ? rideIndexes(stops, ride.board.id, ride.alight.id)
      : { board: -1, alight: -1 };
  const boardLeft =
    position !== null && boardIndex >= 0
      ? stopsUntil(position, boardIndex)
      : null;
  const alightLeft =
    position !== null && alightIndex >= 0
      ? stopsUntil(position, alightIndex)
      : null;
  const raw = trackingPhase(boardLeft, alightLeft);

  useEffect(() => {
    setPhase("waiting");
    setAnnouncement(null);
  }, [target]);
  // Once you've arrived, the bus going quiet no longer matters.
  const lost = missing && phase !== "arrived";
  useEffect(() => {
    if (lost) return;
    const next = advancePhase(phase, raw);
    if (next === phase) return;
    setPhase(next);
    if (next === "headOut" || next === "nextStop" || next === "arrived") {
      setAnnouncement(next);
      track("track_bus_milestone", { milestone: MILESTONE[next] });
    }
  }, [raw, lost, phase]);
  useEffect(() => {
    if (lost) {
      setAnnouncement("lost");
      track("track_bus_milestone", { milestone: "lost" });
    } else setAnnouncement((current) => (current === "lost" ? null : current));
  }, [lost]);

  return {
    active,
    start,
    stop,
    option: active ? target?.option : undefined,
    ride: active ? ride : undefined,
    bus: active ? bus : undefined,
    /** The bus's entry in the live feed right now, if it's in it. */
    liveBus,
    lost,
    phase,
    announcement,
    stops,
    position,
    boardIndex,
    alightIndex,
    boardLeft,
    alightLeft,
    now,
    reassigned,
    acknowledgeReassigned,
  };
}

export type Tracking = ReturnType<typeof useTracking>;
