import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { decodeArchiveChunk, type RecordedFix } from "@metro/core";
import { memoryObjectStore, spyObjectStore, testClockAt } from "@metro/core/testing";
import { LIVE_ARCHIVE_KEY, makeRecorder, type RecorderShape } from "@metro/fleet";

const T0 = Date.parse("2026-10-12T08:00:00+05:30");
const SECOND = 1_000;
const MINUTE = 60_000;
const fix = (id: string, at: number): RecordedFix => ({ id, lat: 6.9, lng: 79.86, receivedAt: at, timestamp: at });

const withRecorder = <A>(
  maxPendingRows: number | undefined,
  use: (recorder: RecorderShape, spy: ReturnType<typeof spyObjectStore>) => Effect.Effect<A>,
) => {
  const spy = spyObjectStore(memoryObjectStore());
  return Effect.runPromise(
    Effect.gen(function* () {
      const recorder = yield* makeRecorder({ store: spy.store, instance: "fleet", ...(maxPendingRows ? { maxPendingRows } : {}) });
      return { result: yield* use(recorder, spy), spy };
    }).pipe(Effect.provide(testClockAt(T0))),
  );
};

const ids = async (body: Uint8Array) => (await decodeArchiveChunk(body)).map((row) => row.bus_id);

test("a flush writes one deduplicated chunk and the live file", async () => {
  const { spy } = await withRecorder(undefined, (recorder) =>
    Effect.gen(function* () {
      recorder.record(fix("a", T0));
      recorder.record(fix("a", T0));
      recorder.record(fix("b", T0 + SECOND));
      yield* recorder.flush;
    }),
  );
  assert.deepEqual(spy.puts.map((put) => put.key), ["raw/2026-10-12/080000-fleet.ndjson.gz", LIVE_ARCHIVE_KEY]);
  assert.deepEqual(await ids(spy.puts[0].body), ["a", "b"]);
  assert.equal(spy.puts[0].options.cacheControl, "public, max-age=31536000, immutable");
  assert.equal(spy.puts[0].options.contentType, "application/x-ndjson");
  assert.deepEqual([...spy.puts[1].body], [...spy.puts[0].body]);
  assert.equal(spy.puts[1].options.cacheControl, "public, max-age=60");
});

test("nothing recorded writes nothing", async () => {
  const { spy } = await withRecorder(undefined, (recorder) => recorder.flush);
  assert.deepEqual(spy.puts, []);
});

test("failed uploads stay pending and go up in order once storage recovers", async () => {
  const { result, spy } = await withRecorder(undefined, (recorder, store) =>
    Effect.gen(function* () {
      store.setFailing(true);
      recorder.record(fix("a", T0));
      yield* recorder.flush;
      yield* TestClock.adjust(5 * MINUTE);
      recorder.record(fix("b", T0 + 5 * MINUTE));
      yield* recorder.flush;
      const failing = yield* recorder.status;
      store.setFailing(false);
      yield* TestClock.adjust(5 * MINUTE);
      yield* recorder.flush;
      return { failing, recovered: yield* recorder.status };
    }),
  );
  assert.deepEqual(result.failing, { lastWriteAt: null, failingSince: T0, pendingRows: 2, droppedRows: 0 });
  assert.deepEqual(result.recovered, { lastWriteAt: T0 + 10 * MINUTE, failingSince: null, pendingRows: 0, droppedRows: 0 });
  assert.deepEqual(spy.puts.map((put) => put.key), [
    "raw/2026-10-12/080000-fleet.ndjson.gz",
    "raw/2026-10-12/080500-fleet.ndjson.gz",
    LIVE_ARCHIVE_KEY,
  ]);
  const live = spy.puts[2].body;
  assert.equal(live.length, spy.puts[0].body.length + spy.puts[1].body.length);
});

test("pending rows are capped, dropping the oldest and counting them", async () => {
  const { result, spy } = await withRecorder(2, (recorder, store) =>
    Effect.gen(function* () {
      store.setFailing(true);
      recorder.record(fix("a", T0));
      recorder.record(fix("b", T0 + SECOND));
      yield* recorder.flush;
      yield* TestClock.adjust(5 * MINUTE);
      recorder.record(fix("c", T0 + 5 * MINUTE));
      yield* recorder.flush;
      store.setFailing(false);
      yield* TestClock.adjust(5 * MINUTE);
      yield* recorder.flush;
      return yield* recorder.status;
    }),
  );
  assert.equal(result.droppedRows, 1);
  assert.deepEqual(await ids(spy.puts[0].body), ["b"]);
  assert.deepEqual(await ids(spy.puts[1].body), ["c"]);
});

test("two flushes in the same second never reuse a chunk name", async () => {
  const { spy } = await withRecorder(undefined, (recorder) =>
    Effect.gen(function* () {
      recorder.record(fix("a", T0));
      yield* recorder.flush;
      recorder.record(fix("b", T0));
      yield* recorder.flush;
    }),
  );
  const chunks = spy.puts.filter((put) => put.key !== LIVE_ARCHIVE_KEY).map((put) => put.key);
  assert.deepEqual(chunks, ["raw/2026-10-12/080000-fleet.ndjson.gz", "raw/2026-10-12/080001-fleet.ndjson.gz"]);
});

test("the live file keeps only chunks since the start of the previous hour", async () => {
  const { spy } = await withRecorder(undefined, (recorder) =>
    Effect.gen(function* () {
      recorder.record(fix("a", T0));
      yield* recorder.flush;
      yield* TestClock.adjust(90 * MINUTE);
      recorder.record(fix("b", T0 + 90 * MINUTE));
      yield* recorder.flush;
      yield* TestClock.adjust(35 * MINUTE);
      recorder.record(fix("c", T0 + 125 * MINUTE));
      yield* recorder.flush;
    }),
  );
  const lives = spy.puts.filter((put) => put.key === LIVE_ARCHIVE_KEY);
  const chunks = spy.puts.filter((put) => put.key !== LIVE_ARCHIVE_KEY);
  assert.equal(lives[1].body.length, chunks[0].body.length + chunks[1].body.length);
  assert.equal(lives[2].body.length, chunks[1].body.length + chunks[2].body.length);
});

test("a flush is due only every 5 minutes", async () => {
  const { result, spy } = await withRecorder(undefined, (recorder, store) =>
    Effect.gen(function* () {
      recorder.record(fix("a", T0));
      yield* TestClock.adjust(5 * MINUTE - SECOND);
      yield* recorder.flushIfDue;
      const early = store.puts.length;
      yield* TestClock.adjust(SECOND);
      yield* recorder.flushIfDue;
      return early;
    }),
  );
  assert.equal(result, 0);
  assert.equal(spy.puts[0].key, "raw/2026-10-12/080500-fleet.ndjson.gz");
});
