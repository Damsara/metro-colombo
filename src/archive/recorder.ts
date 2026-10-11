import { hostname } from "node:os";
import { Duration, Effect, Layer, Metric, Schedule } from "effect";
import { LiveFleet } from "../live-fleet.js";
import { UpstreamApi } from "../upstream.js";
import { ArchiveStore, type ArchiveStoreShape } from "./r2.js";
import {
  chunkKey,
  colomboDay,
  dedupe,
  encodeChunk,
  toArchiveRow,
  type ArchiveRow,
  type RecordedFix,
} from "./rows.js";

const FLUSH_EVERY = Duration.minutes(5);
// About an hour of fixes at a busy time; older ones go if storage stays down longer.
const MAX_PENDING_ROWS = 100_000;
const CHUNK_CACHE = "public, max-age=31536000, immutable";

const chunks = Metric.counter("archive.chunks", { incremental: true });
const rowsWritten = Metric.counter("archive.rows", { incremental: true });
const rowsDropped = Metric.counter("archive.dropped_rows", {
  incremental: true,
});

type Pending = { readonly key: string; rows: ArchiveRow[] };

export function makeFlusher(options: {
  readonly take: Effect.Effect<ReadonlyArray<RecordedFix>>;
  readonly store: ArchiveStoreShape;
  readonly instance: string;
  readonly now: () => number;
  readonly maxPendingRows?: number;
}): Effect.Effect<void> {
  const pending: Pending[] = [];
  const cap = options.maxPendingRows ?? MAX_PENDING_ROWS;

  const trim = Effect.gen(function* () {
    let total = pending.reduce((sum, chunk) => sum + chunk.rows.length, 0);
    let dropped = 0;
    while (total > cap && pending.length) {
      const oldest = pending[0];
      const excess = Math.min(oldest.rows.length, total - cap);
      oldest.rows = oldest.rows.slice(excess);
      if (!oldest.rows.length) pending.shift();
      total -= excess;
      dropped += excess;
    }
    if (dropped) yield* Metric.update(rowsDropped, dropped);
  });

  return Effect.gen(function* () {
    const rows = dedupe((yield* options.take).map(toArchiveRow));
    if (rows.length)
      pending.push({ key: chunkKey(options.now(), options.instance), rows });
    yield* trim;
    while (pending.length) {
      const chunk = pending[0];
      const uploaded = yield* options.store
        .put(chunk.key, encodeChunk(chunk.rows), {
          contentType: "application/x-ndjson",
          cacheControl: CHUNK_CACHE,
        })
        .pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.as(
              Effect.andThen(
                Metric.update(
                  Metric.withAttributes(chunks, { outcome: "failed" }),
                  1,
                ),
                Effect.logWarning("archive upload failed", error),
              ),
              false,
            ),
          ),
        );
      if (!uploaded) return;
      pending.shift();
      yield* Metric.update(Metric.withAttributes(chunks, { outcome: "ok" }), 1);
      yield* Metric.update(rowsWritten, chunk.rows.length);
    }
  });
}

const writeReference = Effect.fn("FleetRecorder.writeReference")(function* (
  store: ArchiveStoreShape,
) {
  const api = yield* UpstreamApi;
  const routes = yield* api.routes;
  const stops = yield* Effect.forEach(
    routes.flatMap((route) =>
      route.directions.map((direction) => ({ route, direction })),
    ),
    ({ route, direction }) =>
      api.stopsFor(route.id, direction.id).pipe(
        Effect.map((list) => ({
          route_code: route.code,
          direction_id: direction.id,
          stops: list,
        })),
      ),
    { concurrency: 4 },
  );
  const json = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value));
  yield* store.put("raw/reference/routes.json", json(routes), {
    contentType: "application/json",
  });
  yield* store.put("raw/reference/stops.json", json(stops), {
    contentType: "application/json",
  });
});

export const FleetRecorder = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* ArchiveStore;
    if (!store.enabled) return;
    const fleet = yield* LiveFleet;
    const flush = makeFlusher({
      take: fleet.takeRecorded,
      store,
      instance: hostname(),
      now: Date.now,
    });
    let referenceDay = "";
    const reference = Effect.suspend(() => {
      const day = colomboDay(Date.now());
      if (day === referenceDay) return Effect.void;
      return writeReference(store).pipe(
        Effect.tap(() => Effect.sync(() => (referenceDay = day))),
        Effect.catch((error) =>
          Effect.logWarning("archive reference snapshot failed", error),
        ),
      );
    });
    yield* fleet.takeRecorded;
    yield* Effect.addFinalizer(() => flush);
    yield* Effect.andThen(reference, flush).pipe(
      Effect.withSpan("FleetRecorder.flush"),
      Effect.repeat(Schedule.spaced(FLUSH_EVERY)),
      Effect.forkScoped,
    );
  }),
);
