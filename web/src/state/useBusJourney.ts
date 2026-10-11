import type { BusJourney, JourneyMarks } from "../lib/busCard";
import type { LiveBus } from "../types";

export type BusJourneyResult =
  | { status: "ready"; journey: BusJourney }
  | { status: "loading" }
  | { status: "unknown"; reason: "noRoute" | "noDirection" | "offRoute" };

export function useBusJourney(
  _bus: LiveBus | null,
  _marks?: JourneyMarks,
): BusJourneyResult | null {
  return null;
}
