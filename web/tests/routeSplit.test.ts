import assert from "node:assert/strict";
import { test } from "vitest";
import { splitRoute } from "../src/lib/routeSplit";
import type { MapRoute } from "../src/types";

const latMeters = 111320;
const lngMeters = latMeters * Math.cos((6.9271 * Math.PI) / 180);
const origin = { lng: 79.86, lat: 6.93 };
const at = (x: number, y: number) => [
  origin.lng + x / lngMeters,
  origin.lat + y / latMeters,
];
const bus = (x: number, y: number) => {
  const [lng, lat] = at(x, y);
  return { lng, lat };
};
const meters = ([lng, lat]: number[]) => ({
  x: Math.round((lng - origin.lng) * lngMeters * 100) / 100,
  y: Math.round((lat - origin.lat) * latMeters * 100) / 100,
});
const trace = (line: number[][]) => line.map(meters);

function route(lines: number[][][]): MapRoute {
  return {
    code: "CM01",
    directionId: "out",
    color: "#000",
    geometry: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry:
            lines.length === 1
              ? {
                  type: "LineString",
                  coordinates: lines[0].map(([x, y]) => at(x, y)),
                }
              : {
                  type: "MultiLineString",
                  coordinates: lines.map((line) =>
                    line.map(([x, y]) => at(x, y)),
                  ),
                },
        },
      ],
    },
  };
}

const straight = route([
  [
    [0, 0],
    [100, 0],
    [200, 0],
  ],
]);

test("cuts mid-segment at the interpolated point", () => {
  const split = splitRoute(straight, bus(150, 10))!;
  assert.deepEqual(trace(split.behind[0]), [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 150, y: 0 },
  ]);
  assert.deepEqual(trace(split.ahead[0]), [
    { x: 150, y: 0 },
    { x: 200, y: 0 },
  ]);
});

test("cuts at a vertex without a sliver", () => {
  const split = splitRoute(straight, bus(100, 0))!;
  assert.deepEqual(trace(split.behind[0]), [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]);
  assert.deepEqual(trace(split.ahead[0]), [
    { x: 100, y: 0 },
    { x: 200, y: 0 },
  ]);
});

test("a bus at the start has nothing behind it", () => {
  const split = splitRoute(straight, bus(0, 0))!;
  assert.equal(split.behind.length, 0);
  assert.equal(split.ahead[0].length, 3);
});

test("a bus at the end has nothing ahead of it", () => {
  const split = splitRoute(straight, bus(200, 0))!;
  assert.equal(split.ahead.length, 0);
  assert.equal(split.behind[0].length, 3);
});

test("a MultiLineString keeps earlier parts behind and later parts ahead", () => {
  const split = splitRoute(
    route([
      [
        [0, 0],
        [100, 0],
      ],
      [
        [100, 50],
        [200, 50],
      ],
      [
        [200, 100],
        [300, 100],
      ],
    ]),
    bus(150, 55),
  )!;
  assert.equal(split.behind.length, 2);
  assert.equal(split.ahead.length, 2);
  assert.deepEqual(trace(split.behind[1]), [
    { x: 100, y: 50 },
    { x: 150, y: 50 },
  ]);
  assert.deepEqual(trace(split.ahead[0]), [
    { x: 150, y: 50 },
    { x: 200, y: 50 },
  ]);
});

test("a loop route splits into the lap so far and the lap to come", () => {
  const split = splitRoute(
    route([
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
        [0, 5],
      ],
    ]),
    bus(100, 50),
  )!;
  assert.deepEqual(trace(split.behind[0]), [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ]);
  const ahead = trace(split.ahead[0]);
  assert.deepEqual(ahead[0], { x: 100, y: 50 });
  assert.deepEqual(ahead.at(-1), { x: 0, y: 0 });
});

test("a bus more than 300 m from the line gets no split", () => {
  assert.equal(splitRoute(straight, bus(100, 301)), null);
  assert.notEqual(splitRoute(straight, bus(100, 299)), null);
});
