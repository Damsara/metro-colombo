import type { LiveBus } from "./types";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// Validate live positions from `/api/live` before they reach the map.
export function normalizeBuses(values: readonly unknown[]): LiveBus[] {
  const buses: LiveBus[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const bus = value as Record<string, unknown>;
    const lat = Number(bus.lat),
      lng = Number(bus.lng);
    if (
      bus.lat == null ||
      bus.lng == null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      continue;
    const normalized: LiveBus = { lat, lng };
    const id = asString(bus.id) ?? asString(bus.bus_id);
    if (id) normalized.id = id;
    if (typeof bus.route_code === "string")
      normalized.route_code = bus.route_code;
    if (typeof bus.route_id === "string") normalized.route_id = bus.route_id;
    if (typeof bus.direction_id === "string")
      normalized.direction_id = bus.direction_id;
    if (typeof bus.registration_number === "string")
      normalized.registration_number = bus.registration_number;
    if (isFiniteNumber(bus.current_capacity))
      normalized.current_capacity = bus.current_capacity;
    if (isFiniteNumber(bus.total_capacity))
      normalized.total_capacity = bus.total_capacity;
    if (isFiniteNumber(bus.timestamp)) normalized.timestamp = bus.timestamp;
    if (isFiniteNumber(bus.heading)) normalized.heading = bus.heading;
    buses.push(normalized);
  }
  return buses;
}
