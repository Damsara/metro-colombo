import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  decodeTrackedRide,
  decodeTripRequest,
  encodeTrackedRide,
  encodeTripRequest,
  type SavedRide,
} from "../src/lib/tracking";
import { Route } from "../src/routes/index";

vi.mock("../src/App", () => ({ default: () => null }));

const request = { from: "stop & 1", to: "නැවතුම/2", date: "2026-10-11" };
const saved: SavedRide = {
  route: "CM01",
  direction: "out/1",
  board: request.from,
  alight: request.to,
  time: "2026-10-11T13:30:00+05:30",
  slot: "slot & 1",
  plate: "WP NE-6544",
};

test("trip and tracked ride values survive URL encoding", () => {
  const url = new URL("https://example.test/");
  url.searchParams.set("journey", encodeTripRequest(request));
  url.searchParams.set("ride", encodeTrackedRide(saved));
  const reopened = new URL(url.toString());
  assert.deepEqual(
    decodeTripRequest(reopened.searchParams.get("journey")),
    request,
  );
  assert.deepEqual(decodeTrackedRide(reopened.searchParams.get("ride")), saved);
});

test("old, incomplete and malformed URL values are harmless", () => {
  for (const value of [
    undefined,
    null,
    1,
    "1",
    {},
    "",
    "%",
    "from=a&to=b",
    "from=a&to=a&date=2026-10-11",
    "from=a&to=b&date=2026-02-30",
  ]) {
    assert.equal(decodeTripRequest(value), null);
    assert.equal(decodeTrackedRide(value), null);
  }
  assert.equal(
    decodeTrackedRide(encodeTrackedRide({ ...saved, slot: "", time: "" })),
    null,
  );
  assert.equal(
    decodeTrackedRide(encodeTrackedRide({ ...saved, time: "bad" })),
    null,
  );
  assert.deepEqual(
    decodeTrackedRide(encodeTrackedRide({ ...saved, slot: "" })),
    { ...saved, slot: "" },
  );
});

function routerAt(entry = "/") {
  const root = createRootRoute();
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    validateSearch: Route.options.validateSearch,
  });
  return createRouter({
    isServer: false,
    origin: "https://example.test",
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
}

test("router validation preserves reload data and accepts legacy flags", async () => {
  const router = routerAt();
  await router.load();
  await router.navigate({
    to: "/",
    search: {
      journey: encodeTripRequest(request),
      ride: encodeTrackedRide(saved),
      trip: 1,
      track: 1,
    },
  });
  const reloaded = routerAt(router.state.location.href);
  await reloaded.load();
  const search = reloaded.state.location.search;
  assert.deepEqual(decodeTripRequest(search.journey), request);
  assert.deepEqual(decodeTrackedRide(search.ride), saved);
  assert.equal(search.trip, 1);
  assert.equal(search.track, 1);
  const legacy = routerAt("/?trip=1&track=1&journey=bad&ride=bad");
  await legacy.load();
  const legacySearch = legacy.state.location.search;
  assert.equal(legacySearch?.trip, 1);
  assert.equal(legacySearch?.track, 1);
  assert.equal(decodeTripRequest(legacySearch?.journey), null);
  assert.equal(decodeTrackedRide(legacySearch?.ride), null);
});

test("replacing payloads preserves the results and tracking Back steps", async () => {
  const router = routerAt();
  await router.load();
  await router.navigate({
    to: "/",
    search: { journey: encodeTripRequest(request) },
    replace: true,
  });
  await router.navigate({
    to: "/",
    search: (previous) => ({ ...previous, trip: 1 }),
  });
  await router.navigate({
    to: "/",
    search: (previous) => ({ ...previous, ride: encodeTrackedRide(saved) }),
    replace: true,
  });
  await router.navigate({
    to: "/",
    search: (previous) => ({ ...previous, track: 1 }),
  });
  await router.navigate({
    to: "/",
    search: (previous) => ({
      ...previous,
      ride: encodeTrackedRide({ ...saved, plate: "NEW-1234" }),
    }),
    replace: true,
  });
  router.history.back();
  await router.load();
  assert.equal(router.state.location.search.track, undefined);
  assert.equal(router.state.location.search.trip, 1);
  router.history.back();
  await router.load();
  assert.equal(router.state.location.search.trip, undefined);
});
