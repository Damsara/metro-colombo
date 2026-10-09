import assert from "node:assert/strict";
import { test } from "vitest";
import { BusMotion } from "../src/busMotion";
import type { LiveBus, MapRoute, Route } from "../src/types";

const latMeters = 111320;
const lngMeters = latMeters * Math.cos((6.9271 * Math.PI) / 180);
const origin = { lng: 79.86, lat: 6.93 };
const coordinate = (x: number, y: number) => [
  origin.lng + x / lngMeters,
  origin.lat + y / latMeters,
];
const meters = (bus: LiveBus) => ({
  x: (bus.lng - origin.lng) * lngMeters,
  y: (bus.lat - origin.lat) * latMeters,
});
const route: Route = {
  id: "r",
  code: "CM01",
  name: "Route",
  directions: [
    { id: "out", start_location: "A", end_location: "B", geojson_url: "" },
    { id: "back", start_location: "B", end_location: "A", geojson_url: "" },
  ],
};
function path(
  points: number[][],
  directionId = "out",
  code = "CM01",
): MapRoute {
  return {
    code,
    directionId,
    color: "#000",
    geometry: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: points.map(([x, y]) => coordinate(x, y)),
          },
        },
      ],
    },
  };
}
function fix(
  x: number,
  y: number,
  seconds: number,
  extra: Partial<LiveBus> = {},
): LiveBus {
  const [lng, lat] = coordinate(x, y);
  return {
    id: "bus",
    route_code: "CM01",
    direction_id: "out",
    lng,
    lat,
    timestamp: 1800000000 + seconds,
    ...extra,
  };
}
function setup(
  paths = [
    path([
      [0, 0],
      [100, 0],
      [100, 300],
    ]),
  ],
) {
  const motion = new BusMotion();
  motion.setRoutes(paths, [route]);
  return motion;
}

test("optimistic motion stays on the bend, advances every frame, and turns with the path", () => {
  const motion = setup();
  motion.update([fix(20, 0, 0)], 0);
  motion.sample(0);
  motion.update([fix(60, 0, 4)], 4000);
  let previous = meters(motion.sample(4000)[0]);
  let previousHeading = 90;
  for (let now = 4016; now <= 20000; now += 16) {
    const bus = motion.sample(now)[0],
      position = meters(bus);
    assert.ok(
      position.x >= previous.x - 0.001 && position.y >= previous.y - 0.001,
      "progress cannot oscillate backwards",
    );
    assert.ok(
      Math.hypot(position.x - previous.x, position.y - previous.y) < 0.4,
      "one frame is not a GPS step",
    );
    assert.ok(
      Math.abs(position.y) < 0.001 || Math.abs(position.x - 100) < 0.001,
      "no diagonal corner cutting",
    );
    assert.ok(
      Math.abs(((bus.heading! - previousHeading + 540) % 360) - 180) < 5,
      "no heading snaps",
    );
    previous = position;
    previousHeading = bus.heading!;
  }
  assert.ok(
    previous.y > 70,
    "prediction continues through the gap between GPS fixes",
  );
  assert.ok(previousHeading < 5, "bus faces north after the turn");
});

test("a fresh GPS correction preserves the currently displayed position", () => {
  const motion = setup();
  motion.update([fix(0, 0, 0)], 0);
  motion.sample(0);
  motion.update([fix(50, 0, 5)], 5000);
  const before = meters(motion.sample(9000)[0]);
  motion.update([fix(82, 0, 9)], 9000);
  const after = meters(motion.sample(9000)[0]);
  assert.ok(
    Math.hypot(after.x - before.x, after.y - before.y) < 0.001,
    "no teleport on arrival",
  );
  const later = meters(motion.sample(12000)[0]);
  assert.ok(later.x >= after.x && later.y >= after.y);
});

test("direction selects the assigned return path, not an adjacent forward path or another route", () => {
  const motion = setup([
    path([
      [0, 0],
      [500, 0],
    ]),
    path(
      [
        [500, 5],
        [0, 5],
      ],
      "back",
    ),
    path(
      [
        [0, 4],
        [500, 4],
      ],
      "out",
      "CM02",
    ),
  ]);
  motion.update([fix(400, 5, 0, { direction_id: "reverse", heading: 270 })], 0);
  motion.sample(0);
  motion.update(
    [fix(350, 5, 5, { direction_id: "reverse", heading: 270 })],
    5000,
  );
  const bus = motion.sample(15000)[0],
    point = meters(bus);
  assert.ok(point.x < 300 && Math.abs(point.y - 5) < 0.001);
  assert.ok(Math.abs(bus.heading! - 270) < 1);
});

test("off-route buses smooth toward GPS but do not snap or invent a road", () => {
  const motion = setup([
    path([
      [0, 0],
      [500, 0],
    ]),
  ]);
  motion.update([fix(10, 100, 0)], 0);
  motion.sample(0);
  motion.update([fix(60, 100, 5)], 5000);
  const early = meters(motion.sample(6000)[0]);
  assert.ok(early.x > 10 && early.x < 60 && Math.abs(early.y - 100) < 0.001);
  const later = meters(motion.sample(120000)[0]);
  assert.ok(Math.abs(later.x - 60) < 0.001 && Math.abs(later.y - 100) < 0.001);
});

test("an unrecognized direction cannot fall back to the first nearby route", () => {
  const motion = setup([
    path([
      [0, 0],
      [500, 0],
    ]),
  ]);
  motion.update([fix(50, 15, 0, { direction_id: "unrecognized" })], 0);
  assert.ok(Math.abs(meters(motion.sample(5000)[0]).y - 15) < 0.001);
});

test("a bus does not adopt a different route just because that route is nearer", () => {
  const motion = setup([
    path(
      [
        [0, 0],
        [500, 0],
      ],
      "out",
      "CM02",
    ),
  ]);
  motion.update([fix(50, 15, 0)], 0);
  motion.update([fix(100, 15, 5)], 5000);
  const point = meters(motion.sample(60000)[0]);
  assert.ok(Math.abs(point.x - 100) < 0.001 && Math.abs(point.y - 15) < 0.001);
});

test("snap hysteresis retains noisy matched GPS but detaches for a genuine diversion", () => {
  const motion = setup([
    path([
      [0, 0],
      [500, 0],
    ]),
  ]);
  motion.update([fix(50, 20, 0)], 0);
  motion.sample(0);
  motion.update([fix(100, 35, 5)], 5000);
  assert.ok(Math.abs(meters(motion.sample(10000)[0]).y) < 0.001);
  motion.update([fix(150, 90, 10)], 10000);
  const diverted = meters(motion.sample(25000)[0]);
  assert.ok(Math.abs(diverted.y - 90) < 0.001);
});

test("stationary GPS jitter and arbitrary heading updates cannot spin or shuttle a bus", () => {
  for (const onRoute of [true, false]) {
    const motion = setup([
      path([
        [0, 0],
        [500, 0],
      ]),
    ]);
    const y = onRoute ? 0 : 100;
    motion.update([fix(200, y, 0, { heading: 90 })], 0);
    const first = motion.sample(1000)[0];
    for (let i = 1; i <= 12; i++) {
      motion.update(
        [
          fix(200 + (i % 2 ? 3 : -3), y + (i % 2 ? 2 : -2), i * 5, {
            heading: i % 2 ? 0 : 180,
          }),
        ],
        i * 5000,
      );
      const bus = motion.sample(i * 5000 + 1000)[0];
      assert.ok(Math.abs(bus.heading! - first.heading!) < 0.001);
      assert.ok(
        Math.hypot(
          (bus.lng - first.lng) * lngMeters,
          (bus.lat - first.lat) * latMeters,
        ) < 0.001,
      );
    }
  }
});

test("out-of-order timestamps and impossible single fixes do not reverse or relocate a bus", () => {
  const motion = setup([
    path([
      [0, 0],
      [5000, 0],
    ]),
  ]);
  motion.update([fix(100, 0, 0)], 0);
  motion.sample(0);
  motion.update([fix(150, 0, 5)], 5000);
  const before = meters(motion.sample(6000)[0]);
  motion.update([fix(1000, 0, 6, { heading: 270 })], 6000);
  motion.update([fix(20, 0, 2, { heading: 270 })], 6100);
  const after = meters(motion.sample(6100)[0]);
  assert.ok(after.x >= before.x && after.x < before.x + 3);
  assert.ok(Math.abs(motion.sample(6200)[0].heading! - 90) < 0.001);
});

test("stale predictions stop, reduced motion uses fixes, and vanished buses are removed", () => {
  const motion = setup([
    path([
      [0, 0],
      [5000, 0],
    ]),
  ]);
  motion.update([fix(0, 0, 0)], 0);
  motion.sample(0);
  motion.update([fix(50, 0, 5)], 5000);
  const stopped = meters(motion.sample(100000)[0]);
  assert.deepEqual(meters(motion.sample(200000)[0]), stopped);
  assert.ok(Math.abs(meters(motion.sample(200000, true)[0]).x - 50) < 0.001);
  motion.update([], 200001);
  assert.deepEqual(motion.sample(200002), []);
});

test("a circular route crosses its endpoint continuously without reversing progress", () => {
  const motion = setup([
    path([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ]),
  ]);
  motion.update([fix(0, 30, 0, { heading: 180 })], 0);
  motion.sample(0);
  motion.update([fix(0, 10, 2, { heading: 180 })], 2000);
  let previous = meters(motion.sample(2000)[0]);
  for (let now = 2016; now < 10000; now += 16) {
    const point = meters(motion.sample(now)[0]);
    assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) < 0.4);
    assert.ok(Math.abs(point.x) < 0.001 || Math.abs(point.y) < 0.001);
    previous = point;
  }
  assert.ok(previous.x > 40 && Math.abs(previous.y) < 0.001);
});
