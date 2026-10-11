import assert from "node:assert/strict";
import { test } from "vitest";
import { roadBearing } from "../src/lib/roadBearing";

const eastWest: [number, number][] = [
  [79.85, 6.9],
  [79.87, 6.9],
];
const northSouth: [number, number][] = [
  [79.9, 6.88],
  [79.9, 6.92],
];

test("a stop on an east-west road faces east", () => {
  assert.equal(Math.round(roadBearing([79.86, 6.9001], [eastWest])!), 90);
});

test("the nearest road wins", () => {
  assert.equal(
    Math.round(roadBearing([79.8999, 6.9], [eastWest, northSouth])!),
    0,
  );
});

test("the line's drawing direction doesn't matter", () => {
  const reversed = [...northSouth].reverse();
  assert.equal(Math.round(roadBearing([79.9, 6.9], [reversed])!), 0);
});

test("no road nearby gives no bearing", () => {
  assert.equal(roadBearing([79.86, 6.95], [eastWest]), null);
});
