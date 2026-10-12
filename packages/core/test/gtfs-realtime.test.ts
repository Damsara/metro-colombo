import assert from "node:assert/strict";
import { test } from "node:test";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { encodeVehiclePositions } from "@metro/core";

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const decode = (bytes: Uint8Array) =>
  FeedMessage.toObject(FeedMessage.decode(bytes), { longs: String });

test("vehicle positions decode with the official GTFS-Realtime bindings, with the route code as trip route_id", () => {
  const feed = decode(
    encodeVehiclePositions(
      [
        {
          id: "bus-a",
          lat: 6.9271,
          lng: 79.8612,
          heading: 90,
          route_code: "138",
          registration_number: "WP-NA-1001",
          current_capacity: 35,
          total_capacity: 70,
          timestamp: 1_791_685_800_000,
        },
        { id: "bus-b", lat: 6.8, lng: 79.9 },
      ],
      1_791_685_805,
    ),
  );
  assert.deepEqual(feed.header, {
    gtfsRealtimeVersion: "2.0",
    incrementality: 0,
    timestamp: "1791685805",
  });
  assert.equal(feed.entity.length, 2);
  const [a, b] = feed.entity;
  assert.equal(a.id, "bus-a");
  assert.deepEqual(a.vehicle.vehicle, {
    id: "bus-a",
    licensePlate: "WP-NA-1001",
  });
  assert.ok(Math.abs(a.vehicle.position.latitude - 6.9271) < 1e-5);
  assert.ok(Math.abs(a.vehicle.position.longitude - 79.8612) < 1e-5);
  assert.equal(a.vehicle.position.bearing, 90);
  assert.equal(a.vehicle.timestamp, "1791685800");
  assert.equal(a.vehicle.occupancyPercentage, 50);
  assert.deepEqual(a.vehicle.trip, { routeId: "138" });
  assert.deepEqual(b.vehicle.vehicle, { id: "bus-b" });
  assert.equal(b.vehicle.timestamp, undefined);
  assert.equal(b.vehicle.position.bearing, undefined);
  assert.equal(b.vehicle.trip, undefined);
});

test("an empty fleet is a valid feed with no entities", () => {
  const feed = decode(encodeVehiclePositions([], 1_791_685_805));
  assert.equal(feed.header.gtfsRealtimeVersion, "2.0");
  assert.equal(feed.entity, undefined);
});

test("four hundred buses round-trip, exercising multi-byte lengths", () => {
  const buses = Array.from({ length: 400 }, (_, index) => ({
    id: `bus-${index}`,
    lat: 6.9,
    lng: 79.8,
    timestamp: 1_791_685_800_000,
  }));
  const feed = decode(encodeVehiclePositions(buses, 1_791_685_805));
  assert.equal(feed.entity.length, 400);
  assert.equal(feed.entity[399].vehicle.vehicle.id, "bus-399");
});

test("occupancy is clamped to 0 to 100 so odd capacities never corrupt the feed", () => {
  const bus = (
    id: string,
    current_capacity: number,
    total_capacity: number,
  ) => ({ id, lat: 6.9, lng: 79.8, current_capacity, total_capacity });
  const feed = decode(
    encodeVehiclePositions(
      [
        bus("negative", -10, 70),
        bus("negative-total", 35, -70),
        bus("over", 140, 70),
        { id: "after", lat: 6.8, lng: 79.9, route_code: "138" },
      ],
      1_791_685_805,
    ),
  );
  assert.deepEqual(
    feed.entity.map((entity) => [
      entity.id,
      entity.vehicle.occupancyPercentage,
    ]),
    [
      ["negative", 0],
      ["negative-total", 0],
      ["over", 100],
      ["after", undefined],
    ],
  );
  assert.deepEqual(feed.entity[3].vehicle.trip, { routeId: "138" });
});
