import assert from "node:assert/strict";
import { test } from "vitest";
import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useBusJourney,
  type BusJourneyResult,
} from "../src/state/useBusJourney";
import type { JourneyMarks } from "../src/lib/busCard";
import type { LiveBus, Route, RouteStops, Stop } from "../src/types";

function stopAt(id: string, index: number): Stop {
  return {
    id,
    stop_code: id,
    stop_name_en: id,
    stop_name_si: id,
    stop_name_tm: id,
    latitude: 6.8 + index * 0.01,
    longitude: 79.9,
    sequence_number: index + 1,
  };
}
const stops = Array.from("abcde", stopAt);
const near = (lat: number) => ({ lat, lng: 79.9 });
const bus: LiveBus = {
  ...near(6.8),
  route_code: "CM01",
  direction_id: "d1",
  registration_number: "WP-NE-6544",
};
const route: Route = {
  id: "r1",
  code: "CM01",
  name: "Route 1",
  directions: [
    { id: "d1", start_location: "a", end_location: "e", geojson_url: "" },
    { id: "d2", start_location: "e", end_location: "a", geojson_url: "" },
  ],
};

function client(routes = true, withStops = true) {
  const result = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  if (routes) result.setQueryData(["routes"], [route]);
  if (withStops) {
    for (const direction of route.directions) {
      result.setQueryData<RouteStops>(
        ["route-stops", route.code, direction.id],
        {
          route_code: route.code,
          direction_id: direction.id,
          direction_label: direction.end_location,
          stops:
            direction.id === "d1"
              ? [...stops].reverse()
              : [...stops].reverse().map((stop, index) => ({
                  ...stop,
                  sequence_number: index + 1,
                })),
        },
      );
    }
  }
  return result;
}

type Sample = { bus: LiveBus | null; marks?: JourneyMarks };
function render(samples: Sample[], queryClient = client()) {
  const results: (BusJourneyResult | null)[] = [];
  function Probe() {
    const [index, setIndex] = useState(0);
    const sample = samples[index];
    results.push(useBusJourney(sample.bus, sample.marks));
    if (index + 1 < samples.length) setIndex(index + 1);
    return null;
  }
  renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: queryClient,
      children: createElement(Probe),
    }),
  );
  return results;
}

test("no bus has no journey and a bus without a route is unknown", () => {
  assert.deepEqual(
    render([{ bus: null }, { bus: { ...bus, route_code: undefined } }]),
    [null, { status: "unknown", reason: "noRoute" }],
  );
  assert.deepEqual(
    render([{ bus: { ...bus, route_code: undefined, route_id: "missing" } }]),
    [{ status: "unknown", reason: "noRoute" }],
  );
});

test("unknown and missing directions never fall back to the first direction", () => {
  for (const direction_id of [undefined, "", "missing", "2", "-1"]) {
    assert.deepEqual(render([{ bus: { ...bus, direction_id } }]), [
      { status: "unknown", reason: "noDirection" },
    ]);
  }
  assert.deepEqual(render([{ bus: { ...bus, route_code: "missing" } }]), [
    { status: "unknown", reason: "noDirection" },
  ]);
});

test("route metadata and direction stops each have a loading state", () => {
  assert.deepEqual(render([{ bus }], client(false, false)), [
    { status: "loading" },
  ]);
  assert.deepEqual(
    render(
      [{ bus: { ...bus, route_code: undefined, route_id: "r1" } }],
      client(false, false),
    ),
    [{ status: "loading" }],
  );
  assert.deepEqual(render([{ bus }], client(true, false)), [
    { status: "loading" },
  ]);
  assert.deepEqual(render([{ bus: null }], client(false, false)), [null]);
});

test("a ready journey sorts stops before positioning and applies marks", () => {
  const [result] = render([
    {
      bus: { ...bus, ...near(6.8115) },
      marks: { boardId: "d", alightId: "e" },
    },
  ]);
  assert.ok(result?.status === "ready");
  assert.equal(result.journey.position, 1.5);
  assert.equal(result.journey.lastPassed?.stop.id, "b");
  assert.equal(result.journey.ahead[0].stop.id, "c");
  assert.equal(result.journey.board?.mark, "board");
  assert.equal(result.journey.alight?.mark, "alight");
  assert.equal(result.journey.stopsToBoard, 2);
});

test("route ids and recognised direction aliases resolve to catalog ids", () => {
  for (const direction_id of ["d1", "forward", "0", "d2", "REVERSE", "1"]) {
    const [result] = render([
      { bus: { ...bus, route_code: undefined, route_id: "r1", direction_id } },
    ]);
    assert.ok(result?.status === "ready");
    assert.equal(result.journey.routeCode, "CM01");
    assert.equal(
      result.journey.directionId,
      ["d1", "forward", "0"].includes(direction_id) ? "d1" : "d2",
    );
  }
});

test("the 800 metre cutoff checks every stop on the chosen direction", () => {
  const latitudeOffset = (meters: number) =>
    ((meters / 6371000) * 180) / Math.PI;
  for (const meters of [799, 801]) {
    const [result] = render([
      { bus: { ...bus, ...near(6.8 - latitudeOffset(meters)) } },
    ]);
    if (meters < 800) assert.equal(result?.status, "ready");
    else assert.deepEqual(result, { status: "unknown", reason: "offRoute" });
  }
  const [nearLast] = render([{ bus: { ...bus, ...near(stops[4].latitude) } }]);
  assert.ok(nearLast?.status === "ready");
  assert.equal(nearLast.journey.terminus.state, "here");
  assert.deepEqual(render([{ bus: { ...bus, lat: NaN } }]), [
    { status: "unknown", reason: "offRoute" },
  ]);
  const empty = client();
  empty.setQueryData<RouteStops>(["route-stops", "CM01", "d1"], {
    route_code: "CM01",
    direction_id: "d1",
    direction_label: "",
    stops: [],
  });
  assert.deepEqual(render([{ bus }], empty), [
    { status: "unknown", reason: "offRoute" },
  ]);
});

test("fresh feed objects and GPS movement within a half step retain the result", () => {
  const results = render([
    { bus, marks: { boardId: "d" } },
    {
      bus: { ...bus, ...near(6.8001), current_capacity: 20 },
      marks: { boardId: "d" },
    },
    { bus: { ...bus, ...near(6.8015) }, marks: { boardId: "d" } },
    { bus: { ...bus, ...near(6.803) }, marks: { boardId: "d" } },
  ]);
  assert.equal(results[0], results[1]);
  assert.notEqual(results[1], results[2]);
  assert.equal(results[2], results[3]);
});

test("plate, direction, marks and off-route movement invalidate the journey", () => {
  const results = render([
    { bus },
    { bus: { ...bus, registration_number: "OTHER" } },
    { bus: { ...bus, direction_id: "d2" } },
    { bus, marks: { boardId: "d" } },
    { bus, marks: { boardId: "d", alightId: "e" } },
    { bus: { ...bus, lng: 80.9 } },
    { bus: null },
    { bus },
  ]);
  for (let index = 1; index < results.length; index++)
    assert.notEqual(results[index - 1], results[index]);
  assert.deepEqual(results[5], { status: "unknown", reason: "offRoute" });
  assert.equal(results[6], null);
  assert.equal(results[7]?.status, "ready");
});
