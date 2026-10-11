import assert from "node:assert/strict";
import { test } from "vitest";
import { planTabBuses } from "../src/lib/mapBuses";
import type { JourneyOption, LiveBus, Route } from "../src/types";

const route = (code: string): Route => ({
  id: `id-${code}`,
  code,
  name: code,
  directions: [
    {
      id: `${code}-out`,
      start_location: "A",
      end_location: "B",
      geojson_url: "",
    },
    {
      id: `${code}-back`,
      start_location: "B",
      end_location: "A",
      geojson_url: "",
    },
  ],
});
const routes = [route("1"), route("2"), route("3")];

const ride = (code: string, direction: string) => ({
  kind: "ride" as const,
  ride: { route: { code, name: code }, direction_id: direction },
});

const journey = (...rides: [string, string][]): JourneyOption =>
  ({
    legs: rides.map(([code, direction]) => ride(code, direction)),
  }) as unknown as JourneyOption;

const bus = (id: string, code: string, direction?: string): LiveBus => ({
  id,
  lat: 0,
  lng: 0,
  route_code: code,
  direction_id: direction,
});

const buses = [
  bus("a", "1", "1-out"),
  bus("b", "1", "1-back"),
  bus("c", "2", "2-out"),
  bus("d", "3", "3-out"),
  bus("e", "1"),
  bus("f", "1", "sideways"),
];
const routeCodeOf = (b: LiveBus) => b.route_code;
const ids = (list: LiveBus[]) => list.map((b) => b.id);

const run = (journeys: JourneyOption[] | null, keep: LiveBus[] = []) =>
  planTabBuses({ buses, routes, routeCodeOf, journeys, keep });

test("no results showing keeps every bus", () => {
  assert.deepEqual(run(null), buses);
});

test("listed options keep buses on any ride's route and direction", () => {
  const result = run([journey(["1", "1-out"]), journey(["2", "2-out"])]);
  assert.deepEqual(ids(result), ["a", "c", "e", "f"]);
});

test("a selected transfer journey keeps both routes' buses", () => {
  const result = run([journey(["1", "1-out"], ["3", "3-out"])]);
  assert.deepEqual(ids(result), ["a", "d", "e", "f"]);
});

test("unknown or missing direction is kept when the route matches", () => {
  const result = run([journey(["1", "1-back"])]);
  assert.deepEqual(ids(result), ["b", "e", "f"]);
});

test("the followed and tracked buses are kept whatever their route", () => {
  const result = run([journey(["1", "1-out"])], [buses[2], buses[3]]);
  assert.deepEqual(ids(result), ["a", "c", "d", "e", "f"]);
});

test("a bus with no id is matched by registration", () => {
  const plated: LiveBus = {
    lat: 0,
    lng: 0,
    route_code: "2",
    registration_number: "NB-1",
  };
  const result = planTabBuses({
    buses: [plated],
    routes,
    routeCodeOf,
    journeys: [journey(["1", "1-out"])],
    keep: [{ ...plated }],
  });
  assert.deepEqual(result, [plated]);
});
