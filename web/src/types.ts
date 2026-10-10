import type { FeatureCollection, Geometry } from "geojson";

export type Language = "en" | "si" | "ta";

export function isLanguage(value: string): value is Language {
  return value === "en" || value === "si" || value === "ta";
}

export interface Direction {
  id: string;
  start_location: string;
  end_location: string;
  geojson_url: string;
}
export interface Route {
  id: string;
  code: string;
  name: string;
  color_hex?: string;
  directions: Direction[];
}
export interface Stop {
  id: string;
  stop_code: string;
  stop_name_en: string;
  stop_name_si: string;
  stop_name_tm: string;
  latitude: number;
  longitude: number;
  sequence_number?: number;
}
export interface CatalogStop extends Stop {
  /** Ids of every direction-specific stop merged into this entry. */
  ids: string[];
  routes: string[];
  towards?: string[];
}
/** A landmark and the stop nearest to it. */
export interface Place {
  id: number;
  name: string;
  name_si: string;
  name_ta: string;
  category: string;
  walk_meters: number;
  stop_code: string;
  stop_id: string;
}
export function placeTitle(place: Place, language: Language): string {
  return (
    (language === "si"
      ? place.name_si
      : language === "ta"
        ? place.name_ta
        : place.name
    ).trim() || place.name
  );
}
export interface RouteStops {
  route_code: string;
  direction_id: string;
  direction_label: string;
  stops: Stop[];
}
export interface LiveBus {
  id?: string;
  lat: number;
  lng: number;
  route_code?: string;
  route_id?: string;
  direction_id?: string;
  registration_number?: string;
  heading?: number;
  current_capacity?: number;
  total_capacity?: number;
  timestamp?: number;
}

// Stable identity for a live bus across position updates.
export function busKey(bus: LiveBus): string {
  return bus.id ?? bus.registration_number ?? "";
}

const plate = (value: string) => value.replace(/[^\da-z]/gi, "").toUpperCase();

/** The live position of a journey's assigned bus, if it is reporting now. */
export function findLiveBus(
  buses: readonly LiveBus[],
  assigned: { id?: string; registration_number: string } | undefined,
): LiveBus | undefined {
  if (!assigned) return undefined;
  const wanted = plate(assigned.registration_number);
  return buses.find(
    (bus) =>
      (assigned.id && bus.id === assigned.id) ||
      (wanted !== "" &&
        bus.registration_number !== undefined &&
        plate(bus.registration_number) === wanted),
  );
}

// How soon before boarding a bus on the route counts as running this trip.
// Any earlier and it's most likely still finishing the previous run.
const ON_TRIP_LEAD_MS = 60 * 60_000;

// Any estimate at all beats the timetable here, live or not.
function bestKnownTime(stop: JourneyStop): number {
  return Date.parse(stop.estimated_time ?? stop.scheduled_time ?? "");
}

/**
 * Whether a live assigned bus is running this ride now. A bus is assigned to
 * a whole day of departures, so reporting live alone may mean it is on
 * another route, heading the other way, or on an earlier run.
 */
export function isOnRide(bus: LiveBus, ride: Ride, now: number): boolean {
  if (bus.route_code && bus.route_code !== ride.route.code) return false;
  if (bus.direction_id && bus.direction_id !== ride.direction_id) return false;
  const board = bestKnownTime(ride.board);
  const alight = bestKnownTime(ride.alight);
  if (Number.isFinite(board) && board - now > ON_TRIP_LEAD_MS) return false;
  if (Number.isFinite(alight) && now > alight) return false;
  return true;
}

/** How crowded a bus feels: roomy, filling up or crowded. */
export type Crowding = "roomy" | "filling" | "crowded";

interface Occupancy {
  current: number;
  total: number;
  percent: number;
  crowding: Crowding;
}

export function occupancy(bus: LiveBus): Occupancy | null {
  const current = bus.current_capacity;
  const total = bus.total_capacity;
  if (
    typeof current !== "number" ||
    typeof total !== "number" ||
    !Number.isFinite(current) ||
    !Number.isFinite(total) ||
    total <= 0
  )
    return null;
  const percent = Math.min(1, Math.max(0, current / total));
  // Total capacity counts standing room, so "filling up" starts around when
  // the seats run out.
  const crowding =
    percent >= 0.85 ? "crowded" : percent >= 0.55 ? "filling" : "roomy";
  return { current, total, percent, crowding };
}
export interface LiveFeed {
  success: boolean;
  timestamp: number;
  /** Milliseconds since the server received `timestamp`'s update. */
  age_ms?: number;
  buses: LiveBus[];
}
type JourneyStop = Stop & {
  scheduled_time?: string;
  estimated_time?: string;
  time_status?: string;
};
export interface Ride {
  route: { code: string; name: string };
  direction_id: string;
  slot_id?: string;
  schedule_id?: string;
  end_location: string;
  bus?: { id?: string; registration_number: string };
  board: JourneyStop;
  alight: JourneyStop;
  stops?: JourneyStop[];
  travel_minutes?: number;
}
export interface Move {
  from_stop: Stop;
  to_stop: Stop;
  estimated_minutes: number;
  distance_meters: number;
  depart_time: string;
  arrive_time: string;
}
export type Leg = { kind: "ride"; ride: Ride } | { kind: "move"; move: Move };
export interface JourneyOption {
  departure_time: string;
  arrival_time: string;
  total_minutes: number;
  rides: number;
  transfers: number;
  total_fare: {
    full_amount: number;
    half_amount: number;
    complete: boolean;
    /** The fare category was assumed by the planner rather than known. */
    category_assumed?: boolean;
  };
  legs: Leg[];
}
export interface JourneyPlan {
  from_stop: Stop;
  to_stop: Stop;
  date: string;
  queried_at: string;
  is_now: boolean;
  options: JourneyOption[];
}
export type RouteGeometry = FeatureCollection<Geometry>;
export interface MapRoute {
  code: string;
  directionId?: string;
  color: string;
  geometry: RouteGeometry;
}
/** The direction a live bus reports, or undefined when it doesn't say. */
export function busDirection(
  route: Route | undefined,
  raw?: string,
): Direction | undefined {
  const directions = route?.directions ?? [];
  if (!raw) return undefined;
  const match = directions.find((item) => item.id === raw);
  if (match) return match;
  if (raw.toLowerCase() === "forward") return directions[0];
  if (raw.toLowerCase() === "reverse") return directions[1];
  const index = Number(raw);
  return Number.isInteger(index) ? directions[index] : undefined;
}

/** Resolve live-feed direction_id to a fare-service direction uuid. */
export function resolveBusDirectionId(
  route: Route | undefined,
  raw?: string,
): string | undefined {
  return (busDirection(route, raw) ?? route?.directions[0])?.id;
}
export interface RouteRef {
  routeCode: string;
  directionId?: string;
}
export interface MapViewProps {
  routes: MapRoute[];
  /** Route metadata (directions), used to place buses on their path. */
  routeCatalog: Route[];
  /** When set (bus selected), only this route line is drawn. */
  routeLock?: RouteRef | null;
  /** Highlight these routes and fade the others. */
  emphasizeRoutes?: RouteRef[];
  stops: Stop[];
  buses: LiveBus[];
  from: Stop | null;
  to: Stop | null;
  selectedStop: Stop | null;
  selectedJourney: JourneyOption | null;
  selectedBus: LiveBus | null;
  followBus: boolean;
  language: Language;
  onStopSelect: (stop: Stop) => void;
  onBusSelect: (bus: LiveBus | null) => void;
  onFollowChange: (follow: boolean) => void;
  showLive: boolean;
  onShowLiveChange: (show: boolean) => void;
  /**
   * On phones, how much of the map the header (top) and the drawer (bottom)
   * cover, in pixels, so framing and following keep clear of them.
   */
  insets?: { top: number; bottom: number };
}

export function stopName(stop: Stop, language: Language): string {
  return (
    (language === "si"
      ? stop.stop_name_si
      : language === "ta"
        ? stop.stop_name_tm
        : stop.stop_name_en
    )?.trim() || stop.stop_name_en
  );
}
/** Upstream place names are sometimes all capitals ("COLOMBO FORT"). */
export function placeName(name: string): string {
  return name === name.toUpperCase()
    ? name.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
    : name;
}
export function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}
export const COLOMBO_OFFSET_MS = 5.5 * 3600000;

/** The date in Colombo (YYYY-MM-DD) at `now`, which defaults to this moment. */
export function colomboDate(now: number = Date.now()): string {
  return new Date(now + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
}
