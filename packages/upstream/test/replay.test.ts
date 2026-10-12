import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Exit, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { encodeArchiveChunk, ObjectStore, type ArchiveRow } from "@metro/core";
import {
  memoryObjectStore,
  settle,
  spyObjectStore,
  testClockAt,
} from "@metro/core/testing";
import {
  LiveFeed,
  ReplayFeed,
  replayHourKey,
  replayInstant,
  replayRoutesKey,
} from "@metro/upstream";

const DAY = "2026-10-11";
const SECOND = 1_000;
const at = (time: string) => Date.parse(`2026-10-11T${time}+05:30`);
const row = (bus_id: string, time: string): ArchiveRow => ({
  bus_id,
  route_id: "route-1",
  lat: 6.9,
  lng: 79.86,
  reported_at: at(time) - 100,
  received_at: at(time),
});

const seeded = async () => {
  const spy = spyObjectStore(memoryObjectStore());
  const put = (key: string, body: Uint8Array) =>
    Effect.runPromise(
      spy.store.put(key, body, { contentType: "application/x-ndjson" }),
    );
  await put(
    replayHourKey(DAY, 8),
    await encodeArchiveChunk([
      row("bus-b", "08:00:02.100"),
      row("bus-a", "08:00:00.100"),
      row("bus-a", "08:00:05.100"),
      row("bus-b", "08:00:07.100"),
      row("bus-a", "08:00:10.100"),
    ]),
  );
  await put(
    replayHourKey(DAY, 9),
    await encodeArchiveChunk([row("bus-a", "09:00:00.100")]),
  );
  await put(
    replayRoutesKey(DAY),
    new TextEncoder().encode(
      JSON.stringify([{ id: "route-1", code: "138", name: "Pettah" }]),
    ),
  );
  spy.gets.length = 0;
  return spy;
};

const replayLayer = (
  store: ReturnType<typeof spyObjectStore>["store"],
  now: number,
  env: Record<string, string> = {},
) =>
  ReplayFeed.pipe(
    Layer.provide(Layer.succeed(ObjectStore, store)),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnvRecord({ REPLAY_DATE: DAY, ...env }),
      ),
    ),
    Layer.provideMerge(testClockAt(now)),
  );

const replay = (
  store: ReturnType<typeof spyObjectStore>["store"],
  now: number,
  steps: ReadonlyArray<number>,
) => {
  const batches: Array<ReadonlyArray<Record<string, unknown>>> = [];
  return Effect.runPromise(
    Effect.gen(function* () {
      const feed = yield* LiveFeed;
      const fiber = yield* feed
        .run(Option.none(), {
          onMessage: () => {},
          onBatch: (payload) =>
            void batches.push(
              payload as ReadonlyArray<Record<string, unknown>>,
            ),
        })
        .pipe(Effect.forkChild);
      yield* settle;
      for (const step of steps) {
        yield* TestClock.adjust(step);
        yield* settle;
      }
      yield* Fiber.interrupt(fiber);
      return batches;
    }).pipe(Effect.provide(replayLayer(store, now))),
  );
};

test("the replay clock follows Colombo's time of day, scaled by speed", () => {
  assert.equal(
    replayInstant(Date.parse("2026-10-12T08:00:05+05:30"), DAY, 1),
    at("08:00:05"),
  );
  assert.equal(
    replayInstant(Date.parse("2026-10-12T06:00:00+05:30"), DAY, 2),
    at("12:00:00"),
  );
  assert.equal(
    replayInstant(Date.parse("2026-10-12T08:00:00+05:30"), DAY, 4),
    at("08:00:00"),
  );
});

test("rows come out in time order, starting a minute back, with timestamps moved to today", async () => {
  const spy = await seeded();
  const batches = await replay(
    spy.store,
    Date.parse("2026-10-12T08:00:05+05:30"),
    [SECOND, 5 * SECOND],
  );
  const nonEmpty = batches.filter((batch) => batch.length > 0);
  assert.deepEqual(
    nonEmpty[0].map((fix) => fix.bus_id),
    ["bus-a", "bus-b"],
  );
  assert.deepEqual(
    batches.flat().map((fix) => fix.bus_id),
    ["bus-a", "bus-b", "bus-a", "bus-b", "bus-a"],
  );
  assert.equal(nonEmpty[0][0].timestamp, at("08:00:00.100") - 100 + 86_400_000);
  assert.equal(nonEmpty[0][0].route_id, "route-1");
  assert.equal(nonEmpty[0][0].lat, 6.9);
});

test("only the current hour is read, and the next one is loaded when the clock reaches it", async () => {
  const spy = await seeded();
  const batches = await replay(
    spy.store,
    Date.parse("2026-10-12T08:59:58+05:30"),
    [SECOND, SECOND, SECOND],
  );
  assert.deepEqual(spy.gets, [replayHourKey(DAY, 8), replayHourKey(DAY, 9)]);
  assert.deepEqual(
    batches.flat().map((fix) => fix.bus_id),
    ["bus-a"],
  );
});

test("midnight wraps to the start of the archived day, and missing hours are just quiet", async () => {
  const spy = await seeded();
  const batches = await replay(
    spy.store,
    Date.parse("2026-10-12T23:59:59+05:30"),
    [SECOND, SECOND],
  );
  assert.deepEqual(spy.gets, [replayHourKey(DAY, 23), replayHourKey(DAY, 0)]);
  assert.ok(batches.length >= 2);
  assert.deepEqual(batches.flat(), []);
});

test("route codes come from the prepared routes file, and none is an empty list", async () => {
  const spy = await seeded();
  const routes = (store: typeof spy.store) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* LiveFeed).routes(Option.none());
      }).pipe(Effect.provide(replayLayer(store, Date.now()))),
    );
  assert.deepEqual(await routes(spy.store), [{ id: "route-1", code: "138" }]);
  assert.deepEqual(await routes(memoryObjectStore()), []);
});

test("a bad REPLAY_DATE stops the layer", async () => {
  const exit = await Effect.runPromise(
    Effect.exit(
      Effect.gen(function* () {
        return yield* LiveFeed;
      }).pipe(
        Effect.provide(
          replayLayer(memoryObjectStore(), Date.now(), {
            REPLAY_DATE: "yesterday",
          }),
        ),
      ),
    ),
  );
  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /REPLAY_DATE/);
});

const boundary = async (
  lastHour: number,
  firstHour: number,
  tail: string,
  head: string,
  now: string,
) => {
  const spy = spyObjectStore(memoryObjectStore());
  const put = (key: string, rows: ArchiveRow[]) =>
    encodeArchiveChunk(rows).then((body) =>
      Effect.runPromise(
        spy.store.put(key, body, { contentType: "application/x-ndjson" }),
      ),
    );
  await put(replayHourKey(DAY, lastHour), [row("bus-a", tail)]);
  await put(replayHourKey(DAY, firstHour), [row("bus-b", head)]);
  spy.gets.length = 0;
  const batches = await replay(spy.store, Date.parse(now), [
    SECOND,
    SECOND,
    SECOND,
  ]);
  return { spy, ids: batches.flat().map((fix) => fix.bus_id) };
};

test("rows just before and after an hour boundary each come out once, in order", async () => {
  const { spy, ids } = await boundary(
    8,
    9,
    "08:59:59.500",
    "09:00:00.100",
    "2026-10-12T08:59:58.200+05:30",
  );
  assert.deepEqual(ids, ["bus-a", "bus-b"]);
  assert.deepEqual(spy.gets, [replayHourKey(DAY, 8), replayHourKey(DAY, 9)]);
});

test("rows just before and after midnight each come out once, in order", async () => {
  const { spy, ids } = await boundary(
    23,
    0,
    "23:59:59.500",
    "00:00:00.100",
    "2026-10-12T23:59:58.200+05:30",
  );
  assert.deepEqual(ids, ["bus-a", "bus-b"]);
  assert.deepEqual(spy.gets, [replayHourKey(DAY, 23), replayHourKey(DAY, 0)]);
});
