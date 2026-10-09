import { useCallback, useEffect, useState } from "react";
import { busKey, type LiveBus } from "../types";

/** Which live bus is picked, whether the map follows it, and whether buses show at all. */
export function useBusSelection(buses: LiveBus[], liveLoaded: boolean) {
  const [showLive, setShowLive] = useState(true);
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [followBus, setFollowBus] = useState(false);
  const selectedBus = selectedBusId
    ? (buses.find((bus) => busKey(bus) === selectedBusId) ?? null)
    : null;

  // Picking a bus follows it (and turns live buses back on); null lets go.
  const select = useCallback((bus: LiveBus | null) => {
    setSelectedBusId(bus ? busKey(bus) : null);
    setFollowBus(bus !== null);
    if (bus) setShowLive(true);
  }, []);
  const release = useCallback(() => {
    setSelectedBusId(null);
    setFollowBus(false);
  }, []);
  const changeFollow = useCallback(
    (follow: boolean) => setFollowBus(follow && selectedBusId !== null),
    [selectedBusId],
  );

  // The live feed drops buses that stop reporting. Let go of the selection then.
  useEffect(() => {
    if (selectedBusId && liveLoaded && !selectedBus) release();
  }, [selectedBusId, selectedBus, liveLoaded, release]);

  return {
    showLive,
    setShowLive,
    selectedBusId,
    selectedBus,
    followBus,
    select,
    release,
    changeFollow,
  };
}
