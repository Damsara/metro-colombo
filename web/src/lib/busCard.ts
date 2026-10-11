import type { Stop } from "../types";

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
  _routeCode: string,
  _directionId: string,
  _stops: readonly Stop[],
  _position: number | null,
  _marks?: JourneyMarks,
): BusJourney | null {
  return null;
}

export function journeyStrip(_journey: BusJourney, _maxAhead = 3): StripItem[] {
  return [];
}
