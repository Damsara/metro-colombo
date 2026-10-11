import { hostname } from "node:os";
import {
  Clock,
  Duration,
  Effect,
  Layer,
  Metric,
  PubSub,
  Schedule,
} from "effect";
import { LiveFleet } from "../live-fleet.js";
import { UpstreamApi } from "../upstream.js";
import { ArchiveStore, type ArchiveStoreShape } from "./r2.js";
import {
  chunkKey,
  colomboDay,
  dedupe,
  encodeChunk,
  hourStartKey,
  toArchiveRow,
  type ArchiveRow,
  type RecordedFix,
} from "./rows.js";

export const LIVE_KEY = "today/live.ndjson.gz";

const FLUSH_EVERY = Duration.minutes(5);
// About an hour of fixes at a busy time; older ones go if storage stays down longer.
const MAX_PENDING_ROWS = 100_000;
const MAX_TAKE = 100_000;
const HOUR_MS = 3_600_000;
const CHUNK_CACHE = "public, max-age=31536000, immutable";
const LIVE_CACHE = "public, max-age=60";

const chunks = Metric.counter("archive.chunks", { incremental: true });
const rowsWritten = Metric.counter("archive.rows", { incremental: true });
const rowsDropped = Metric.counter("archive.dropped_rows", {
  incremental: true,
});

type Pending = { readonly key: string; rows: ArchiveRow[] };

const concat = (parts: ReadonlyArray<Uint8Array>) => {
  const joined = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
};

const counted = (outcome: string) =>
  Metric.update(Metric.withAttributes(chunks, { outcome }), 1);

export function makeFlusher(options: {
  readonly take: Effect.Effect<ReadonlyArray<RecordedFix>>;
  readonly store: ArchiveStoreShape;
  readonly instance: string;
  readonly maxPendingRows?: number;
}): Effect.Effect<void> {
  const pending: Pending[] = [];
  // Recently uploaded chunks, kept to rebuild the live file without reading R2 back.
  let recent: { readonly key: string; readonly bytes: Uint8Array }[] = [];
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

  const upload = (key: string, bytes: Uint8Array, cacheControl: string) =>
    options.store
      .put(key, bytes, { contentType: "application/x-ndjson", cacheControl })
      .pipe(
        Effect.as(true),
        Effect.catch((error) =>
          Effect.as(
            Effect.andThen(
              counted("failed"),
              Effect.logWarning("archive upload failed", { key, error }),
            ),
            false,
          ),
        ),
      );

  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const rows = dedupe((yield* options.take).map(toArchiveRow));
    if (rows.length)
      pending.push({ key: chunkKey(now, options.instance), rows });
    yield* trim;
    let uploadedAny = false;
    while (pending.length) {
      const chunk = pending[0];
      const bytes = encodeChunk(chunk.rows);
      if (!(yield* upload(chunk.key, bytes, CHUNK_CACHE))) break;
      pending.shift();
      recent.push({ key: chunk.key, bytes });
      uploadedAny = true;
      yield* counted("ok");
      yield* Metric.update(rowsWritten, chunk.rows.length);
    }
    if (!uploadedAny) return;
    const since = hourStartKey(now - HOUR_MS);
    recent = recent.filter((chunk) => chunk.key >= since);
    yield* upload(
      LIVE_KEY,
      concat(recent.map((chunk) => chunk.bytes)),
      LIVE_CACHE,
    );
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
    const subscription = yield* fleet.subscribeFixes;
    const flush = makeFlusher({
      take: PubSub.takeUpTo(subscription, MAX_TAKE),
      store,
      instance: hostname(),
    });
    let referenceDay = "";
    const reference = Effect.gen(function* () {
      const day = colomboDay(yield* Clock.currentTimeMillis);
      if (day === referenceDay) return;
      yield* writeReference(store);
      referenceDay = day;
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("archive reference snapshot failed", error),
      ),
    );
    yield* Effect.addFinalizer(() => flush);
    yield* Effect.andThen(reference, flush).pipe(
      Effect.withSpan("FleetRecorder.flush"),
      Effect.repeat(Schedule.spaced(FLUSH_EVERY)),
      Effect.forkScoped,
    );
  }),
);
