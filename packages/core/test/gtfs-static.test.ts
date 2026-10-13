import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStaticGtfs,
  csv,
  type GtfsInput,
  lineCoordinates,
  type S,
  staticGtfsFiles,
} from "@metro/core";
import { unzip } from "./support/unzip.ts";

const route = (code: string, color_hex?: string): S.Route => ({
  code,
  id: `${code}-id`,
  name: `${code}, Colombo "Fort"`,
  ...(color_hex ? { color_hex } : {}),
  status: "active",
  is_favorite: false,
  directions: [],
});
const stop = (id: string, code: string): S.Stop => ({
  id,
  stop_code: code,
  stop_name_en: `Stop ${code}`,
  stop_name_si: "",
  stop_name_tm: "",
  sequence_number: 1,
  latitude: 6.9120149,
  longitude: 79.850639,
  status: "active",
});
const line = (coordinates: unknown) => ({
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "LineString", coordinates } },
  ],
});

const text = (input: GtfsInput, name: string) =>
  new TextDecoder().decode(
    staticGtfsFiles(input).find((entry) => entry.name === name)?.bytes,
  );

test("fields with commas, quotes or line breaks are quoted", () => {
  assert.equal(csv(["a", "b"], [['x,"y"', 1]]), 'a,b\r\n"x,""y""",1\r\n');
});

test("routes use the route code as route_id, matching GTFS-RT, with the colour as hex", () => {
  const input = {
    routes: [route("CM06", "#491c80"), route("CM01")],
    stops: [],
    paths: [],
  };
  assert.equal(
    text(input, "routes.txt"),
    "route_id,agency_id,route_short_name,route_long_name,route_type,route_color\r\n" +
      'CM06,LMT,CM06,"CM06, Colombo ""Fort""",3,491C80\r\n' +
      'CM01,LMT,CM01,"CM01, Colombo ""Fort""",3,\r\n',
  );
});

test("a stop on several routes is listed once", () => {
  const input = {
    routes: [],
    stops: [stop("a", "KCR100"), stop("b", "KCR101"), stop("a", "KCR100")],
    paths: [],
  };
  assert.equal(
    text(input, "stops.txt"),
    "stop_id,stop_code,stop_name,stop_lat,stop_lon\r\n" +
      "a,KCR100,Stop KCR100,6.9120149,79.850639\r\n" +
      "b,KCR101,Stop KCR101,6.9120149,79.850639\r\n",
  );
});

test("shapes come from line strings and multi-line strings, numbered from 1", () => {
  const multi = {
    type: "Feature",
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [[79.1, 6.1]],
        [
          [79.2, 6.2],
          ["x", 6.3],
        ],
      ],
    },
  };
  const input = {
    routes: [],
    stops: [],
    paths: [
      { code: "CM06", directionIndex: 0, geojson: line([[79.85, 6.91]]) },
      { code: "CM06", directionIndex: 1, geojson: multi },
    ],
  };
  assert.equal(
    text(input, "shapes.txt"),
    "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\r\n" +
      "CM06_0,6.91,79.85,1\r\n" +
      "CM06_1,6.1,79.1,1\r\n" +
      "CM06_1,6.2,79.2,2\r\n",
  );
});

test("geometry that isn't a line gives no points", () => {
  assert.deepEqual(lineCoordinates(null), []);
  assert.deepEqual(lineCoordinates({ type: "Feature", geometry: null }), []);
  assert.deepEqual(lineCoordinates({ type: "Point", coordinates: [1, 2] }), []);
});

test("the archive holds agency, routes, stops and shapes, and the agency is Colombo's", async () => {
  const files = await unzip(
    await buildStaticGtfs({ routes: [route("CM06")], stops: [], paths: [] }),
  );
  assert.deepEqual(
    [...files.keys()],
    ["agency.txt", "routes.txt", "stops.txt", "shapes.txt"],
  );
  assert.equal(
    new TextDecoder().decode(files.get("agency.txt")?.bytes),
    "agency_id,agency_name,agency_url,agency_timezone,agency_lang\r\n" +
      "LMT,Lanka Metro Transit,https://lankametro.lk,Asia/Colombo,en\r\n",
  );
});
