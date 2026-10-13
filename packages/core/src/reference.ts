import { Schema } from "effect";
import { OCCASION_KINDS } from "./occasions/kinds.js";
import * as S from "./schemas.js";

export const REFERENCE_PREFIX = "reference/";
export const MANIFEST_KEY = "reference/manifest.json";
export const STATUS_KEY = "reference/status.json";
export const MANIFEST_CACHE = "public, max-age=60";
export const STATUS_CACHE = "public, max-age=60";
export const VERSIONED_CACHE = "public, max-age=31536000, immutable";

export const ReferenceName = {
  routes: "routes",
  places: "places",
  occasions: "occasions",
  stopIds: "stop-ids",
  gtfs: "gtfs/static",
  stops: (code: string) => `stops/${code}`,
  path: (code: string, directionId: string) => `paths/${code}/${directionId}`,
} as const;

export const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  updated_at: Schema.Number,
  files: Schema.Record(Schema.String, Schema.String),
});
export type Manifest = Schema.Schema.Type<typeof Manifest>;

export const ReferenceStatus = Schema.Struct({
  checked_at: Schema.Number,
  ok: Schema.Boolean,
  failed: Schema.Array(Schema.String),
  consecutive_failures: Schema.Number,
  last_success_at: Schema.NullOr(Schema.Number),
});
export type ReferenceStatus = Schema.Schema.Type<typeof ReferenceStatus>;

export const RoutesFile = Schema.Array(S.Route);
export const StopsFile = Schema.Array(S.RouteStops);
export const StopIdsFile = Schema.Record(Schema.String, Schema.String);
export const PlacesFile = Schema.Array(S.Place);
export const OccasionsFile = Schema.Array(
  Schema.Struct({
    date: Schema.String,
    kind: Schema.Literals(OCCASION_KINDS),
    title: Schema.String,
  }),
);

export const sha256Hex = async (bytes: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const versionedKey = (
  name: string,
  hash: string,
  extension: "json" | "zip",
) => `${REFERENCE_PREFIX}${name}.${hash.slice(0, 16)}.${extension}`;

export const colourRoutes = <
  R extends { readonly code: string; readonly color_hex?: string },
>(
  routes: ReadonlyArray<R>,
  colours: ReadonlyMap<string, string>,
) =>
  routes.map((route) => ({
    ...route,
    color_hex: colours.get(route.code) ?? route.color_hex,
  }));

export const stopIdsByCode = (
  lists: ReadonlyArray<ReadonlyArray<S.Stop>>,
): Record<string, string> =>
  Object.fromEntries(lists.flat().map((stop) => [stop.stop_code, stop.id]));
