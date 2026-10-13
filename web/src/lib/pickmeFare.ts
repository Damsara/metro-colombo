export interface Point {
  lat: number;
  lng: number;
}

export interface Tariff {
  calibrated: boolean;
  minFare: number;
  minKm: number;
  aboveKmFare: number;
  nightFare: number;
  nightFrom: number;
  nightTo: number;
}

export interface Estimate {
  km: { low: number; high: number };
  minutes: { low: number; high: number };
  fare: { low: number; high: number } | null;
}

/** Placeholder shape taken from the PickMe passenger app; numbers stay zero until a
 *  calibration run fits them, and `fare` is withheld from the UI while uncalibrated. */
export const COLOMBO_TARIFF: Tariff = {
  calibrated: false,
  minFare: 0,
  minKm: 0,
  aboveKmFare: 0,
  nightFare: 0,
  nightFrom: 22,
  nightTo: 5,
};

const EARTH_RADIUS_KM = 6371.0088;
/** Urban band measured against OSRM: 1.52 on Fort–Independence Sq, 1.71 on Fort–Galle
 *  Face, so short hops sit high and intercity sits near 1.2, which is out of scope here. */
const CIRCUITY = { low: 1.4, high: 1.8 };
const SPEED_KMH = { low: 18, high: 28 };

export function straightLineKm(from: Point, to: Point): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function fareRange(
  km: { low: number; high: number },
  hour: number,
  tariff: Tariff,
): { low: number; high: number } | null {
  if (!tariff.calibrated) return null;
  const night =
    hour >= tariff.nightFrom || hour < tariff.nightTo ? tariff.nightFare : 0;
  const at = (distanceKm: number) =>
    (distanceKm <= tariff.minKm
      ? tariff.minFare
      : tariff.minFare + tariff.aboveKmFare * (distanceKm - tariff.minKm)) +
    night;
  return {
    low: Math.round(at(km.low) / 10) * 10,
    high: Math.round(at(km.high) / 10) * 10,
  };
}

export function lastMileEstimate(
  from: Point,
  to: Point,
  hour: number,
  tariff: Tariff = COLOMBO_TARIFF,
): Estimate {
  const straight = straightLineKm(from, to);
  const km = {
    low: Math.round(straight * CIRCUITY.low * 10) / 10,
    high: Math.round(straight * CIRCUITY.high * 10) / 10,
  };
  const minutes = {
    low: Math.max(1, Math.round((km.low / SPEED_KMH.high) * 60)),
    high: Math.max(1, Math.round((km.high / SPEED_KMH.low) * 60)),
  };
  return { km, minutes, fare: fareRange(km, hour, tariff) };
}
