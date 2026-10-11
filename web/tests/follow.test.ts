import assert from "node:assert/strict";
import { test } from "vitest";
import {
  DRAG_RELEASE_PX,
  dragDistance,
  followState,
  liveSignal,
  lostAt,
  nextFollowMode,
} from "../src/lib/follow";
import { LOST_AFTER_MS } from "../src/lib/tracking";

test("tapping the selected bus toggles looking around, never lets go", () => {
  assert.equal(
    nextFollowMode("following", { type: "tapSelected" }),
    "lookingAround",
  );
  assert.equal(
    nextFollowMode("lookingAround", { type: "tapSelected" }),
    "following",
  );
});

test("picking a bus or pressing Follow locks on", () => {
  assert.equal(
    nextFollowMode("lookingAround", { type: "select" }),
    "following",
  );
  assert.equal(
    nextFollowMode("lookingAround", { type: "follow" }),
    "following",
  );
});

test("a drag only lets go once it has gone far enough", () => {
  assert.equal(
    nextFollowMode("following", {
      type: "drag",
      distance: DRAG_RELEASE_PX - 1,
    }),
    "following",
  );
  assert.equal(
    nextFollowMode("following", { type: "drag", distance: DRAG_RELEASE_PX }),
    "lookingAround",
  );
  assert.equal(nextFollowMode("following", { type: "pan" }), "lookingAround");
  assert.equal(dragDistance({ x: 0, y: 0 }, { x: 18, y: 24 }), 30);
});

test("a bus out of the feed waits, then is lost", () => {
  const since = 1_000;
  assert.equal(followState("following", since, since), "waiting");
  assert.equal(
    followState("lookingAround", since, since + LOST_AFTER_MS - 1),
    "waiting",
  );
  assert.equal(followState("following", since, since + LOST_AFTER_MS), "lost");
  assert.equal(lostAt(since), since + LOST_AFTER_MS);
  assert.equal(lostAt(null), null);
});

test("a bus back in the feed returns to what the user had", () => {
  assert.equal(followState("following", null, 5_000), "following");
  assert.equal(followState("lookingAround", null, 5_000), "lookingAround");
  const mode = nextFollowMode("following", { type: "pan" });
  assert.equal(followState(mode, 1_000, 2_000), "waiting");
  assert.equal(followState(mode, null, 3_000), "lookingAround");
});

test("the pulsing dot means a live signal, not following", () => {
  assert.equal(liveSignal("following"), true);
  assert.equal(liveSignal("lookingAround"), true);
  assert.equal(liveSignal("waiting"), false);
  assert.equal(liveSignal("lost"), false);
});
