import type { Point } from "./pickmeFare";

export const PICKME_APP_LINK = "https://app.pickme.lk";

export const PICKME_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.pickme.passenger";

export interface TripTemplate {
  path: string;
  pickup: string;
  drop: string;
}

/** The app verifies https://app.pickme.lk as an Android App Link, but the path and the
 *  query names are server-delivered, so they stay blank until a link the app shares is copied in. */
export const PICKME_TRIP: TripTemplate = { path: "", pickup: "", drop: "" };

export function pickmeLink(
  path = "",
  params: Record<string, string | number> = {},
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key) query.set(key, String(value));
  }
  const search = query.toString();
  return `${PICKME_APP_LINK}${path}${search ? `?${search}` : ""}`;
}

export function pickmeTripLink(
  from: Point,
  to: Point,
  template: TripTemplate = PICKME_TRIP,
): string {
  const params: Record<string, string> = {};
  if (template.pickup) params[template.pickup] = `${from.lat},${from.lng}`;
  if (template.drop) params[template.drop] = `${to.lat},${to.lng}`;
  return pickmeLink(template.path, params);
}
