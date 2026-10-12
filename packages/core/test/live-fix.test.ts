import assert from "node:assert/strict";
import { test } from "node:test";
import { toFix, withRouteCodes } from "@metro/core";

test("keeps only known, well-typed fields from an upstream bus", () => {
  const fix = toFix(
    {
      bus_id: "bus-1",
      latitude: 6.9,
      longitude: 79.86,
      route_code: "CM01",
      heading: 90,
      total_capacity: 70,
      registration_number: "",
      current_capacity: "12",
      driver_phone: "0710000000",
    },
    1000,
  );
  assert.deepEqual(fix, {
    id: "bus-1",
    lat: 6.9,
    lng: 79.86,
    route_code: "CM01",
    heading: 90,
    total_capacity: 70,
    receivedAt: 1000,
  });
});

test("rejects buses without an id or finite coordinates", () => {
  assert.equal(toFix({ lat: 6.9, lng: 79.86 }, 0), undefined);
  assert.equal(toFix({ id: "bus", lat: Number.NaN, lng: 79.86 }, 0), undefined);
  assert.equal(toFix("bus", 0), undefined);
  assert.equal(toFix(null, 0), undefined);
});

test("corrects fixes offset by one degree north and east", () => {
  const fix = toFix({ id: "bus", lat: 7.85, lng: 80.86 }, 0);
  assert.ok(fix);
  assert.ok(Math.abs(fix.lat - 6.85) < 1e-9 && Math.abs(fix.lng - 79.86) < 1e-9);
  assert.equal(toFix({ id: "bus", lat: 6.85, lng: 79.86 }, 0)?.lat, 6.85);
});

test("a bus without a route code takes it from its route id, and one with a code keeps it", () => {
  const routes = [{ id: "r1", code: "CM01" }];
  assert.deepEqual(
    withRouteCodes(
      [
        { id: "a", lat: 6.9, lng: 79.9, route_id: "r1" },
        { id: "b", lat: 6.9, lng: 79.9, route_id: "r1", route_code: "CM02" },
        { id: "c", lat: 6.9, lng: 79.9, route_id: "unknown" },
      ],
      routes,
    ),
    [
      { id: "a", lat: 6.9, lng: 79.9, route_id: "r1", route_code: "CM01" },
      { id: "b", lat: 6.9, lng: 79.9, route_id: "r1", route_code: "CM02" },
      { id: "c", lat: 6.9, lng: 79.9, route_id: "unknown" },
    ],
  );
});
