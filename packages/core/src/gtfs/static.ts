import type * as S from "../schemas.js";
import { type ZipEntry, zip } from "../zip.js";

export const GTFS_AGENCY = {
  agency_id: "LMT",
  agency_name: "Lanka Metro Transit",
  agency_url: "https://lankametro.lk",
  agency_timezone: "Asia/Colombo",
  agency_lang: "en",
} as const;

const BUS = 3;

const cell = (value: string | number) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const csv = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
) => [header, ...rows].map((row) => `${row.map(cell).join(",")}\r\n`).join("");

const isPoint = (value: unknown): value is readonly [number, number] =>
  Array.isArray(value) &&
  value.length >= 2 &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]);

export const lineCoordinates = (
  geojson: unknown,
): Array<readonly [number, number]> => {
  if (typeof geojson !== "object" || geojson === null) return [];
  const node = geojson as {
    readonly type?: unknown;
    readonly features?: unknown;
    readonly geometry?: unknown;
    readonly coordinates?: unknown;
  };
  switch (node.type) {
    case "FeatureCollection":
      return Array.isArray(node.features)
        ? node.features.flatMap(lineCoordinates)
        : [];
    case "Feature":
      return lineCoordinates(node.geometry);
    case "LineString":
      return Array.isArray(node.coordinates)
        ? node.coordinates
            .filter(isPoint)
            .map(([lng, lat]) => [lng, lat] as const)
        : [];
    case "MultiLineString":
      return Array.isArray(node.coordinates)
        ? node.coordinates.flatMap((coordinates) =>
            lineCoordinates({ type: "LineString", coordinates }),
          )
        : [];
    default:
      return [];
  }
};

export type GtfsPath = {
  readonly code: string;
  readonly directionIndex: number;
  readonly geojson: unknown;
};

export type GtfsInput = {
  readonly routes: ReadonlyArray<S.Route>;
  readonly stops: ReadonlyArray<S.Stop>;
  readonly paths: ReadonlyArray<GtfsPath>;
};

const utf8 = new TextEncoder();
const file = (name: string, text: string): ZipEntry => ({
  name,
  bytes: utf8.encode(text),
});

export const staticGtfsFiles = ({ routes, stops, paths }: GtfsInput) => {
  const unique = [...new Map(stops.map((stop) => [stop.id, stop])).values()];
  return [
    file(
      "agency.txt",
      csv(Object.keys(GTFS_AGENCY), [Object.values(GTFS_AGENCY)]),
    ),
    file(
      "routes.txt",
      csv(
        [
          "route_id",
          "agency_id",
          "route_short_name",
          "route_long_name",
          "route_type",
          "route_color",
        ],
        routes.map((route) => [
          route.code,
          GTFS_AGENCY.agency_id,
          route.code,
          route.name,
          BUS,
          (route.color_hex ?? "").replace(/^#/, "").toUpperCase(),
        ]),
      ),
    ),
    file(
      "stops.txt",
      csv(
        ["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon"],
        unique.map((stop) => [
          stop.id,
          stop.stop_code,
          stop.stop_name_en,
          stop.latitude,
          stop.longitude,
        ]),
      ),
    ),
    file(
      "shapes.txt",
      csv(
        ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"],
        paths.flatMap((path) =>
          lineCoordinates(path.geojson).map(([lng, lat], index) => [
            `${path.code}_${path.directionIndex}`,
            lat,
            lng,
            index + 1,
          ]),
        ),
      ),
    ),
  ];
};

export const buildStaticGtfs = (input: GtfsInput) =>
  zip(staticGtfsFiles(input));
