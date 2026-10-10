import assert from "node:assert/strict";
import { test } from "vitest";
import {
  cycleSnap,
  FULL_GAP_PX,
  intentSnap,
  PEEK_PX,
  snapHeights,
  type DrawerView,
  type Snap,
} from "../src/lib/drawerSnap";

const form: DrawerView = {
  tab: "plan",
  showResults: false,
  journeyKey: null,
  busId: null,
  routeCode: null,
  stopId: null,
  tracking: false,
};

test("the handle cycles peek, half, full, half, peek", () => {
  let snap: Snap = "peek";
  let previous: Snap | null = null;
  const seen: Snap[] = [];
  for (let press = 0; press < 5; press++) {
    const next = cycleSnap(snap, previous);
    previous = snap;
    snap = next;
    seen.push(snap);
  }
  assert.deepEqual(seen, ["half", "full", "half", "peek", "half"]);
});

test("from half with no history the handle goes up", () => {
  assert.equal(cycleSnap("half", null), "full");
});

test("snap heights sit below the header and above the home indicator", () => {
  const heights = snapHeights(844, 60, 34);
  assert.equal(heights.full, 844 - 60 - FULL_GAP_PX);
  assert.equal(heights.half, 422);
  assert.equal(heights.peek, PEEK_PX + 34);
});

test("snap heights stay in order on a short screen", () => {
  const heights = snapHeights(300, 60);
  assert.ok(heights.peek <= heights.half);
  assert.ok(heights.half <= heights.full);
  assert.equal(heights.full, 300 - 60 - FULL_GAP_PX);
});

test("new results bring the drawer to half", () => {
  assert.equal(
    intentSnap(form, { ...form, showResults: true }, "full"),
    "half",
  );
});

test("following a bus drops the drawer to peek", () => {
  const results = { ...form, showResults: true };
  assert.equal(
    intentSnap(results, { ...results, busId: "b1" }, "half"),
    "peek",
  );
  assert.equal(
    intentSnap(results, { ...results, busId: "b1" }, "full"),
    "peek",
  );
});

test("a picked journey comes up from peek but keeps its steps in view", () => {
  const results = { ...form, showResults: true };
  const picked = { ...results, journeyKey: "j1" };
  assert.equal(intentSnap(results, picked, "peek"), "half");
  assert.equal(intentSnap(results, picked, "full"), "full");
});

test("opening a route shows it at half", () => {
  const list = { ...form, tab: "routes" as const };
  assert.equal(intentSnap(list, { ...list, routeCode: "100" }, "peek"), "half");
});

test("a picked stop sets the drawer to half for its card, with the map above", () => {
  assert.equal(intentSnap(form, { ...form, stopId: "s1" }, "full"), "half");
  assert.equal(intentSnap(form, { ...form, stopId: "s1" }, "peek"), "half");
});

test("tracking drops the drawer to the map, and leaving it brings results up", () => {
  const results = { ...form, showResults: true, journeyKey: "j1" };
  const tracking = { ...results, busId: "b1", tracking: true };
  assert.equal(intentSnap(results, tracking, "full"), "peek");
  // Live updates while tracking leave the drawer alone.
  assert.equal(intentSnap(tracking, tracking, "half"), "half");
  assert.equal(intentSnap(tracking, results, "peek"), "half");
});

test("unrelated changes leave the drawer where the user put it", () => {
  assert.equal(intentSnap(form, form, "full"), "full");
  const results = { ...form, showResults: true };
  // Going back to the form doesn't move the drawer.
  assert.equal(intentSnap(results, form, "half"), "half");
  // Releasing a bus doesn't either.
  assert.equal(
    intentSnap({ ...results, busId: "b1" }, results, "peek"),
    "peek",
  );
});
