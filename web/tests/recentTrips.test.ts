import assert from "node:assert/strict";
import { test } from "vitest";
import {
  addRecentTrip,
  clearRecentTrips,
  loadRecentTrips,
  RECENT_TRIP_LIMIT,
  recentStops,
  saveRecentTrips,
  type RecentTrip,
} from "../src/lib/recentTrips";
import type { CatalogStop } from "../src/types";

function memoryStore(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set("lmt-go:recent-trips", initial);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function trip(from: string, to: string): RecentTrip {
  return { from: { code: from, name: from }, to: { code: to, name: to } };
}

test("a repeated trip moves to the top instead of being listed twice", () => {
  let trips = addRecentTrip([], trip("A", "B"));
  trips = addRecentTrip(trips, trip("C", "D"));
  trips = addRecentTrip(trips, trip("A", "B"));
  assert.deepEqual(trips, [trip("A", "B"), trip("C", "D")]);
});

test("the way back is a different trip", () => {
  const trips = addRecentTrip([trip("A", "B")], trip("B", "A"));
  assert.equal(trips.length, 2);
});

test("only the newest trips are kept", () => {
  let trips: RecentTrip[] = [];
  for (let index = 0; index < RECENT_TRIP_LIMIT + 3; index++) {
    trips = addRecentTrip(trips, trip(`S${index}`, "End"));
  }
  assert.equal(trips.length, RECENT_TRIP_LIMIT);
  assert.equal(trips[0].from.code, `S${RECENT_TRIP_LIMIT + 2}`);
});

test("saved trips load back, newest first", () => {
  const store = memoryStore();
  saveRecentTrips([trip("A", "B"), trip("C", "D")], store);
  assert.deepEqual(loadRecentTrips(store), [trip("A", "B"), trip("C", "D")]);
  clearRecentTrips(store);
  assert.deepEqual(loadRecentTrips(store), []);
});

test("corrupt or foreign storage loads as no trips", () => {
  assert.deepEqual(loadRecentTrips(memoryStore("{not json")), []);
  assert.deepEqual(loadRecentTrips(memoryStore('{"a":1}')), []);
  assert.deepEqual(loadRecentTrips(null), []);
  const mixed = JSON.stringify([
    trip("A", "B"),
    { from: "A" },
    trip("A", "B"),
    null,
  ]);
  assert.deepEqual(loadRecentTrips(memoryStore(mixed)), [trip("A", "B")]);
});

test("storage that throws never breaks the app", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("full");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadRecentTrips(broken), []);
  assert.doesNotThrow(() => saveRecentTrips([trip("A", "B")], broken));
  assert.doesNotThrow(() => clearRecentTrips(broken));
});

test("recent stops are distinct catalog stops, destinations first", () => {
  const stop = (code: string) =>
    ({ id: code, stop_code: code, stop_name_en: code }) as CatalogStop;
  const stops = ["A", "B", "C"].map(stop);
  const found = recentStops(
    [trip("A", "B"), trip("B", "C"), trip("Gone", "A")],
    stops,
  );
  assert.deepEqual(
    found.map((item) => item.stop_code),
    ["B", "A", "C"],
  );
});
