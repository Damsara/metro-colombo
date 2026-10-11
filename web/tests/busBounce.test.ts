import assert from "node:assert/strict";
import { test } from "vitest";
import { bounceOffset, busBounce } from "../src/lib/busBounce";

const PEAK_FILLING = 550;
const PEAK_CROWDED = 325;

test("roomy buses and buses without occupancy stay still", () => {
  for (const crowding of ["roomy", null] as const) {
    assert.deepEqual(busBounce(crowding, 1234, 0.3), {
      lift: 0,
      squash: 0,
      grow: 1,
      rock: 0,
      wiggle: 0,
    });
  }
});

test("crowded buses hop higher than filling ones", () => {
  const filling = busBounce("filling", PEAK_FILLING, 0);
  const crowded = busBounce("crowded", PEAK_CROWDED, 0);
  assert.ok(filling.lift > 0);
  assert.ok(crowded.lift > filling.lift * 2);
  assert.ok(crowded.grow > filling.grow && filling.grow > 1);
});

test("a crowded bus squashes on landing and stretches in the air", () => {
  assert.equal(busBounce("crowded", 0, 0).lift, 0);
  assert.ok(busBounce("crowded", 0, 0).squash > 0.1);
  assert.ok(busBounce("crowded", PEAK_CROWDED, 0).squash < 0);
});

test("the bounce never lifts the bus below the road or squashes it flat", () => {
  for (let now = 0; now < 3000; now += 37) {
    for (const crowding of ["filling", "crowded"] as const) {
      const bounce = busBounce(crowding, now, 0.42);
      assert.ok(bounce.lift >= 0 && bounce.lift <= 3);
      assert.ok(Math.abs(bounce.squash) < 0.2);
      assert.ok(bounce.grow >= 1 && bounce.grow < 1.2);
      assert.ok(Math.abs(bounce.rock) < 0.1);
      assert.ok(Math.abs(bounce.wiggle) < 0.1);
    }
  }
});

test("each bus keeps its own rhythm", () => {
  assert.equal(bounceOffset("NB-1234"), bounceOffset("NB-1234"));
  assert.notEqual(bounceOffset("NB-1234"), bounceOffset("NB-1235"));
  for (const key of ["a", "NB-1234", "WP-NE-6585", ""]) {
    const offset = bounceOffset(key);
    assert.ok(offset >= 0 && offset < 1, key);
  }
  assert.notDeepEqual(
    busBounce("crowded", 100, bounceOffset("a")),
    busBounce("crowded", 100, bounceOffset("b")),
  );
});
