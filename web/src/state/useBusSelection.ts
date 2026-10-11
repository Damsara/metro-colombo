import { useCallback, useEffect, useState } from "react";
import {
  followState,
  lostAt,
  nextFollowMode,
  type FollowEvent,
  type FollowMode,
} from "../lib/follow";
import { busKey, type LiveBus } from "../types";

/**
 * Which live bus is picked, how the map follows it, and whether buses show
 * at all. `keepKey` is a bus that stays selected even once it's lost.
 */
export function useBusSelection(
  buses: LiveBus[],
  liveLoaded: boolean,
  keepKey: string | null = null,
) {
  const [showLive, setShowLive] = useState(true);
  // The bus as last seen in the feed, so it outlasts a gap in reporting.
  const [picked, setPicked] = useState<LiveBus | null>(null);
  const [mode, setMode] = useState<FollowMode>("following");
  const [missingSince, setMissingSince] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const selectedBusId = picked ? busKey(picked) : null;
  const liveBus = selectedBusId
    ? (buses.find((bus) => busKey(bus) === selectedBusId) ?? null)
    : null;
  const selectedBus = liveBus ?? picked;
  const missing = selectedBusId !== null && liveLoaded && !liveBus;

  const select = useCallback((bus: LiveBus | null) => {
    setPicked(bus);
    setMode((current) => nextFollowMode(current, { type: "select" }));
    setMissingSince(null);
    if (bus) setShowLive(true);
  }, []);
  const release = useCallback(() => {
    setPicked(null);
    setMissingSince(null);
  }, []);
  const dispatch = useCallback(
    (event: FollowEvent) =>
      setMode((current) => nextFollowMode(current, event)),
    [],
  );

  useEffect(() => {
    if (liveBus) setPicked(liveBus);
  }, [liveBus]);
  useEffect(() => {
    setMissingSince((since) => (missing ? (since ?? Date.now()) : null));
  }, [missing]);
  useEffect(() => {
    const at = lostAt(missingSince);
    if (at === null) return;
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, at - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [missingSince]);

  const state = picked ? followState(mode, missingSince, now) : null;
  useEffect(() => {
    if (state === "lost" && selectedBusId !== keepKey) release();
  }, [state, selectedBusId, keepKey, release]);

  return {
    showLive,
    setShowLive,
    selectedBusId,
    selectedBus,
    /** Whether the camera stays locked on the bus, gone quiet or not. */
    followBus: picked !== null && mode === "following",
    followState: state,
    select,
    release,
    dispatch,
  };
}
