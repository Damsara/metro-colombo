import { distanceMeters, type JourneyRequest } from "../api";
import {
  findLiveBus,
  type JourneyPlan,
  type LiveBus,
  type Ride,
  type Stop,
} from "../types";

export interface SavedRide {
  route: string;
  direction: string;
  board: string;
  alight: string;
  time: string;
  slot: string;
  plate: string;
}

export function encodeTripRequest(request: JourneyRequest): string {
  return new URLSearchParams({ ...request }).toString();
}

export function decodeTripRequest(value: unknown): JourneyRequest | null {
  if (typeof value !== "string") return null;
  const params = new URLSearchParams(value);
  const from = params.get("from");
  const to = params.get("to");
  const date = params.get("date");
  if (!from || !to || from === to || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return null;
  const parsed = new Date(date);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    return null;
  return { from, to, date };
}

export function savedRide(ride: Ride, plate: string): SavedRide {
  return {
    route: ride.route.code,
    direction: ride.direction_id,
    board: ride.board.id,
    alight: ride.alight.id,
    time: ride.board.scheduled_time ?? "",
    slot: ride.slot_id ?? "",
    plate,
  };
}

export function encodeTrackedRide(ride: SavedRide): string {
  return new URLSearchParams({ ...ride }).toString();
}

export function decodeTrackedRide(value: unknown): SavedRide | null {
  if (typeof value !== "string") return null;
  const params = new URLSearchParams(value);
  const route = params.get("route");
  const direction = params.get("direction");
  const board = params.get("board");
  const alight = params.get("alight");
  const time = params.get("time") ?? "";
  const slot = params.get("slot") ?? "";
  const plate = params.get("plate") ?? "";
  if (!route || !direction || !board || !alight || (!slot && !time))
    return null;
  if (time && !Number.isFinite(Date.parse(time))) return null;
  return { route, direction, board, alight, time, slot, plate };
}

export function matchingTrackedRide(plan: JourneyPlan, saved: SavedRide) {
  for (const option of plan.options) {
    for (const leg of option.legs) {
      if (leg.kind !== "ride") continue;
      const ride = leg.ride;
      if (
        ride.route.code === saved.route &&
        ride.direction_id === saved.direction &&
        ride.board.id === saved.board &&
        ride.alight.id === saved.alight &&
        (saved.slot
          ? ride.slot_id === saved.slot
          : Date.parse(ride.board.scheduled_time ?? "") ===
            Date.parse(saved.time))
      )
        return { option, ride };
    }
  }
  return null;
}

export function resumeTracking(
  plan: JourneyPlan,
  saved: SavedRide,
  buses: readonly LiveBus[],
) {
  const match = matchingTrackedRide(plan, saved);
  if (!match) return null;
  const bus = findLiveBus(buses, match.ride.bus);
  return bus ? { ...match, bus } : null;
}

export function busReassignment(
  from: string | undefined,
  to: string | undefined,
) {
  const normalize = (plate: string) =>
    plate.replace(/[^\da-z]/gi, "").toUpperCase();
  return from && to && normalize(from) !== normalize(to) ? { from, to } : null;
}

export const AT_STOP_METERS = 40;
// Slack for GPS drift when deciding the bus has left its nearest stop.
const PASSED_SLACK_METERS = 25;
export const HEAD_OUT_STOPS = 2;
export const NEXT_STOP_STOPS = 1;
export const LOST_AFTER_MS = 60_000;

export function orderedStops(stops: readonly Stop[]): Stop[] {
  return stops
    .slice()
    .sort((a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0));
}

// Half steps: n while at stop n, n + 0.5 between stops n and n + 1.
export function busPosition(
  bus: Pick<LiveBus, "lat" | "lng">,
  stops: readonly Stop[],
): number | null {
  if (!stops.length) return null;
  const position = { latitude: bus.lat, longitude: bus.lng };
  let nearest = 0;
  let best = Infinity;
  stops.forEach((stop, index) => {
    const distance = distanceMeters(position, stop);
    if (distance < best) {
      best = distance;
      nearest = index;
    }
  });
  if (best <= AT_STOP_METERS) return nearest;
  // Once past its nearest stop, the bus is closer to the next stop than that
  // stop is.
  const next = stops[nearest + 1];
  if (
    next &&
    distanceMeters(position, next) + PASSED_SLACK_METERS <
      distanceMeters(stops[nearest], next)
  )
    return nearest + 0.5;
  return nearest - 0.5;
}

// Counts the target stop itself: 1 when it is the next one, 0 while the bus is there, negative once passed.
export function stopsUntil(position: number, target: number): number {
  return position > target
    ? Math.floor(target - position)
    : Math.ceil(target - position);
}

export type TrackingPhase =
  | "waiting"
  | "approaching"
  | "headOut"
  | "riding"
  | "nextStop"
  | "arrived";

const ORDER: readonly TrackingPhase[] = [
  "waiting",
  "approaching",
  "headOut",
  "riding",
  "nextStop",
  "arrived",
];

export function trackingPhase(
  boardLeft: number | null,
  alightLeft: number | null,
): TrackingPhase {
  if (boardLeft === null) return "waiting";
  if (boardLeft > HEAD_OUT_STOPS) return "approaching";
  if (boardLeft >= 0) return "headOut";
  if (alightLeft === null || alightLeft > NEXT_STOP_STOPS) return "riding";
  if (alightLeft > 0) return "nextStop";
  return "arrived";
}

// Phases only move forward so GPS jitter around a stop can't flip them back or replay a nudge.
export function advancePhase(
  previous: TrackingPhase,
  next: TrackingPhase,
): TrackingPhase {
  return ORDER.indexOf(next) > ORDER.indexOf(previous) ? next : previous;
}

export function isLost(lastSeen: number, now: number): boolean {
  return now - lastSeen >= LOST_AFTER_MS;
}

// Feed timestamps below this are in seconds rather than milliseconds.
const SECONDS_TIMESTAMP_LIMIT = 1e11;
const toMs = (value: number) =>
  value < SECONDS_TIMESTAMP_LIMIT ? value * 1000 : value;

// Ages the fix by the feed's own timestamp when there is one, so a phone with a wrong clock doesn't count every bus as lost (or none).
export function lastSeenAt(
  bus: Pick<LiveBus, "timestamp">,
  receivedAt: number,
  feedTimestamp?: number,
): number {
  const fix = bus.timestamp;
  if (fix === undefined || !Number.isFinite(fix)) return receivedAt;
  const reference =
    feedTimestamp !== undefined && Number.isFinite(feedTimestamp)
      ? toMs(feedTimestamp)
      : receivedAt;
  return receivedAt - Math.max(0, reference - toMs(fix));
}

export function trackedFix<T>(
  live: T | undefined,
  lastLive: T | null,
  start: T | undefined,
): T | undefined {
  return live ?? lastLive ?? start;
}

// "Last seen" never moves back, and a bus that leaves the feed keeps its last time so it gets the full grace period.
export function nextLastSeen(
  previous: number,
  bus: Pick<LiveBus, "timestamp"> | undefined,
  receivedAt: number,
  feedTimestamp?: number,
): number {
  return bus
    ? Math.max(previous, lastSeenAt(bus, receivedAt, feedTimestamp))
    : previous;
}

// The stop you get off at is the first one at or after boarding, so a loop route that passes a stop twice counts the right visit.
export function rideIndexes(
  stops: readonly Stop[],
  boardId: string,
  alightId: string,
): { board: number; alight: number } {
  const board = stops.findIndex((stop) => stop.id === boardId);
  const alight = stops.findIndex(
    (stop, index) => index >= Math.max(0, board) && stop.id === alightId,
  );
  return { board, alight };
}

// Matched on what doesn't change with live estimates or a bus swap: route, direction, stops and slot.
export function refreshedRide(
  plan: JourneyPlan | undefined,
  ride: Ride,
  bus: LiveBus | undefined,
): Ride {
  const matches = (plan?.options ?? []).flatMap((option) =>
    option.legs.flatMap((leg) =>
      leg.kind === "ride" &&
      leg.ride.route.code === ride.route.code &&
      leg.ride.direction_id === ride.direction_id &&
      leg.ride.board.id === ride.board.id &&
      leg.ride.alight.id === ride.alight.id &&
      (!ride.slot_id || leg.ride.slot_id === ride.slot_id)
        ? [leg.ride]
        : [],
    ),
  );
  if (!matches.length) return ride;
  const sameBus = bus
    ? matches.filter((match) => findLiveBus([bus], match.bus))
    : [];
  const candidates = sameBus.length ? sameBus : matches;
  const departs = (item: Ride) => Date.parse(item.board.scheduled_time ?? "");
  const wanted = departs(ride);
  if (!Number.isFinite(wanted)) return candidates[0];
  const gap = (item: Ride) => {
    const distance = Math.abs(departs(item) - wanted);
    return Number.isNaN(distance) ? Infinity : distance;
  };
  return candidates.reduce((best, item) =>
    gap(item) < gap(best) ? item : best,
  );
}

export function liveMinutes(stop: Ride["board"], now: number): number | null {
  if (stop.time_status !== "live" || !stop.estimated_time) return null;
  const minutes = Math.round((Date.parse(stop.estimated_time) - now) / 60_000);
  return Number.isFinite(minutes) && minutes >= 1 ? minutes : null;
}

export type ProgressRow =
  | { kind: "stop"; index: number; stop: Stop; bus: boolean; target: boolean }
  | { kind: "bus" }
  | { kind: "gap"; count: number };

export function progressRows(
  stops: readonly Stop[],
  position: number,
  target: number,
  max = 5,
): ProgressRow[] {
  if (target < 0 || target >= stops.length || position > target) return [];
  const first = Math.ceil(position);
  const atStop = Number.isInteger(position);
  const rows: ProgressRow[] = atStop ? [] : [{ kind: "bus" }];
  const indexes = Array.from(
    { length: target - first + 1 },
    (_, offset) => first + offset,
  );
  const shown =
    indexes.length > max
      ? [...indexes.slice(0, 2), -1, ...indexes.slice(-2)]
      : indexes;
  for (const index of shown) {
    if (index < 0) {
      rows.push({ kind: "gap", count: indexes.length - 4 });
      continue;
    }
    rows.push({
      kind: "stop",
      index,
      stop: stops[index],
      bus: atStop && index === position,
      target: index === target,
    });
  }
  return rows;
}
