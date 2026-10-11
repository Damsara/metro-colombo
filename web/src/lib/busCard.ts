import type { Stop } from "../types";
import { rideIndexes, stopsUntil } from "./tracking";

export type JourneyStopState = "passed" | "here" | "next" | "ahead";

export interface JourneyStop {
  stop: Stop;
  index: number;
  state: JourneyStopState;
  mark?: "board" | "alight";
}

export interface BusJourney {
  routeCode: string;
  directionId: string;
  position: number;
  lastPassed: JourneyStop | null;
  ahead: JourneyStop[];
  terminus: JourneyStop;
  board: JourneyStop | null;
  alight: JourneyStop | null;
  stopsToBoard: number | null;
}

export type StripItem =
  | { kind: "stop"; stop: JourneyStop }
  | { kind: "bus" }
  | { kind: "gap"; count: number };

export interface JourneyMarks {
  boardId?: string;
  alightId?: string;
}

export function busJourney(
  routeCode: string,
  directionId: string,
  stops: readonly Stop[],
  position: number | null,
  marks?: JourneyMarks,
): BusJourney | null {
  if (
    position === null ||
    !Number.isFinite(position) ||
    !stops.length ||
    position > stops.length - 1
  )
    return null;
  const indexes = rideIndexes(
    stops,
    marks?.boardId ?? "",
    marks?.alightId ?? "",
  );
  const journeyStops: JourneyStop[] = stops.map((stop, index) => ({
    stop,
    index,
    state:
      index < position
        ? "passed"
        : index === position
          ? "here"
          : index === Math.floor(position) + 1
            ? "next"
            : "ahead",
    ...(index === indexes.board
      ? { mark: "board" as const }
      : index === indexes.alight
        ? { mark: "alight" as const }
        : {}),
  }));
  const board = journeyStops[indexes.board] ?? null;
  return {
    routeCode,
    directionId,
    position,
    lastPassed: journeyStops[Math.ceil(position) - 1] ?? null,
    ahead: journeyStops.filter((stop) => stop.index >= position),
    terminus: journeyStops[journeyStops.length - 1],
    board,
    alight: journeyStops[indexes.alight] ?? null,
    stopsToBoard:
      board && board.index >= position
        ? stopsUntil(position, board.index)
        : null,
  };
}

export function journeyStrip(journey: BusJourney, maxAhead = 3): StripItem[] {
  const selected = [
    journey.lastPassed,
    ...journey.ahead.slice(0, Math.max(0, Math.floor(maxAhead))),
    journey.board,
    journey.alight,
    journey.terminus,
  ].filter((stop): stop is JourneyStop => stop !== null);
  const stops = [
    ...new Map(selected.map((stop) => [stop.index, stop])).values(),
  ].sort((a, b) => a.index - b.index);
  const items: StripItem[] = [];
  let previous = Math.max(-1, Math.ceil(journey.position) - 1);
  let busPlaced = false;
  for (const stop of stops) {
    if (!busPlaced && stop.index >= journey.position) {
      items.push({ kind: "bus" });
      busPlaced = true;
    }
    const count = stop.index - previous - 1;
    if (count > 0) items.push({ kind: "gap", count });
    items.push({ kind: "stop", stop });
    previous = stop.index;
  }
  return items;
}
