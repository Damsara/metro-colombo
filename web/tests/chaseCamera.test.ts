import assert from "node:assert/strict";
import { test } from "vitest";
import { chaseBearing, chaseOffset } from "../src/lib/chaseCamera";

test("the camera turns towards the bus's heading, smoothly", () => {
  const next = chaseBearing(0, 90, 100, false);
  assert.ok(next > 0 && next < 90);
  assert.ok(chaseBearing(next, 90, 100, false) > next);
});

test("it takes the short way round past north", () => {
  const next = chaseBearing(350, 10, 100, false);
  assert.ok(next > 350 || next < 10, String(next));
  assert.notEqual(Math.round(next), 180);
});

test("without a heading the camera holds its direction", () => {
  assert.equal(chaseBearing(123, undefined, 100, false), 123);
});

test("with reduced motion it only turns in steps, never drifting", () => {
  assert.equal(chaseBearing(0, 10, 100, true), 0);
  assert.equal(chaseBearing(0, 90, 100, true), 90);
});

test("the bearing always stays within a full circle", () => {
  for (const [from, to] of [
    [359, 1],
    [1, 359],
    [180, -170],
  ] as const) {
    const next = chaseBearing(from, to, 5000, false);
    assert.ok(next >= 0 && next < 360, `${from}->${to}: ${next}`);
  }
});

test("the bus sits in the lower part of the map", () => {
  assert.equal(chaseOffset(800, 0), 160);
  assert.equal(chaseOffset(800, 100), 60);
});
