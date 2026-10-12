import { Predicate } from "effect";
import type * as S from "../schemas.js";

const NETWORK_MAX_LAT = 7.2;
const NETWORK_MAX_LNG = 80.4;

export type Fix = S.LiveBus & { readonly receivedAt: number };

const finite = (value: unknown): number | undefined =>
  Predicate.isNumber(value) && Number.isFinite(value) ? value : undefined;
const nonEmpty = (value: unknown): string | undefined =>
  Predicate.isString(value) && value.length > 0 ? value : undefined;

const OPTIONAL_TEXT = [
  "route_code",
  "route_id",
  "direction_id",
  "registration_number",
] as const;
const OPTIONAL_NUMBERS = [
  "heading",
  "current_capacity",
  "total_capacity",
  "timestamp",
] as const;

export function toFix(input: unknown, receivedAt: number): Fix | undefined {
  if (!Predicate.isObject(input)) return undefined;
  const bus = input as Record<string, unknown>;
  const id = nonEmpty(bus.bus_id) ?? nonEmpty(bus.id);
  let lat = finite(bus.lat) ?? finite(bus.latitude);
  let lng = finite(bus.lng) ?? finite(bus.longitude);
  if (!id || lat === undefined || lng === undefined) return undefined;
  // Some fixes arrive a degree north and east of the truth; the real network sits below 7.2 N and west of 80.4 E.
  if (lat > NETWORK_MAX_LAT || lng > NETWORK_MAX_LNG) {
    lat -= 1;
    lng -= 1;
  }
  const fix: { -readonly [K in keyof Fix]: Fix[K] } = {
    id,
    lat,
    lng,
    receivedAt,
  };
  for (const key of OPTIONAL_TEXT) {
    const value = nonEmpty(bus[key]);
    if (value !== undefined) fix[key] = value;
  }
  for (const key of OPTIONAL_NUMBERS) {
    const value = finite(bus[key]);
    if (value !== undefined) fix[key] = value;
  }
  return fix;
}

export function withRouteCodes(
  buses: ReadonlyArray<Omit<Fix, "receivedAt">>,
  routes: ReadonlyArray<{ readonly id: string; readonly code: string }>,
): S.LiveBus[] {
  const codes = new Map(routes.map((route) => [route.id, route.code]));
  return buses.map((bus) => {
    const route_code =
      bus.route_code ?? (bus.route_id && codes.get(bus.route_id));
    return route_code ? { ...bus, route_code } : bus;
  });
}
