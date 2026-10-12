import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import type { Fix } from "@metro/core";
import { memoryObjectStore } from "@metro/core/testing";
import { LIVE_JSON_KEY, makeLivePublisher } from "@metro/fleet";

const T0 = Date.parse("2026-10-12T08:00:00+05:30");
const fix = (id: string, receivedAt: number): Fix => ({ id, lat: 6.9, lng: 79.86, receivedAt });
const bus = (id: string) => ({ id, lat: 6.9, lng: 79.86 });

const published = async (store: ReturnType<typeof memoryObjectStore>) => {
  const stored = await Effect.runPromise(store.get(LIVE_JSON_KEY));
  assert.ok(stored._tag === "Some");
  return JSON.parse(new TextDecoder().decode(stored.value.body));
};

test("going stale after the fixes aged out still republishes the last fresh buses and their timestamp", async () => {
  const store = memoryObjectStore();
  const { publish } = await Effect.runPromise(makeLivePublisher(store));
  const fixes = [fix("a", T0)];
  const base = { fixes, routes: [], lastBatchAt: T0 };
  await Effect.runPromise(publish({ ...base, now: T0, reason: undefined }));
  await Effect.runPromise(publish({ ...base, now: T0 + 90_000, reason: undefined }));
  await Effect.runPromise(publish({ ...base, now: T0 + 130_000, reason: "feed_down" }));
  const doc = await published(store);
  assert.equal(doc.stale, true);
  assert.deepEqual(doc.buses, [bus("a")]);
  assert.equal(doc.timestamp, T0);
  assert.equal(doc.age_ms, 130_000);
});

test("a stale start republishes the previous snapshot's buses and timestamp", async () => {
  const store = memoryObjectStore();
  const first = await Effect.runPromise(makeLivePublisher(store));
  await Effect.runPromise(first.publish({ now: T0, fixes: [fix("a", T0)], routes: [], lastBatchAt: T0, reason: undefined }));
  const second = await Effect.runPromise(makeLivePublisher(store));
  await Effect.runPromise(second.restore);
  await Effect.runPromise(second.publish({ now: T0 + 600_000, fixes: [], routes: [], lastBatchAt: 0, reason: "feed_down" }));
  const doc = await published(store);
  assert.deepEqual(doc.buses, [bus("a")]);
  assert.equal(doc.timestamp, T0);
});
