import {
  Clock,
  Context,
  Effect,
  Layer,
  Option,
  Schema,
  Semaphore,
} from "effect";
import {
  buildStaticGtfs,
  FALLBACK_OCCASIONS,
  type GtfsPath,
  Manifest,
  MANIFEST_CACHE,
  MANIFEST_KEY,
  ObjectStore,
  type ObjectStoreShape,
  parseJson,
  ReferenceName,
  ReferenceStatus,
  RoutesFile,
  type S,
  sha256Hex,
  STATUS_CACHE,
  STATUS_KEY,
  stopIdsByCode,
  VERSIONED_CACHE,
  versionedKey,
} from "@metro/core";
import { AlertBook, type AlertBookShape, Fleet } from "@metro/fleet";
import {
  ReferenceUpstream,
  type ReferenceUpstreamShape,
  type Token,
  UpstreamError,
} from "@metro/upstream";

export const PUBLISH_EVERY_MS = 55 * 60_000;
export const RUN_TIMEOUT_MS = 5 * 60_000;
export const ALERT_AFTER_FAILURES = 3;
const FETCH_CONCURRENCY = 4;

export type PublishReport = {
  readonly ok: boolean;
  readonly failed: ReadonlyArray<string>;
  readonly written: ReadonlyArray<string>;
};

export type PublisherDeps = {
  readonly store: ObjectStoreShape;
  readonly upstream: ReferenceUpstreamShape;
  readonly book: AlertBookShape;
  readonly token: Effect.Effect<Token>;
};

export type ReferencePublisherShape = {
  readonly run: Effect.Effect<PublishReport>;
  readonly runIfDue: Effect.Effect<Option.Option<PublishReport>>;
};

type Built = {
  readonly name: string;
  readonly body: Uint8Array;
  readonly zip: boolean;
};

const utf8 = new TextEncoder();
const encode = (value: unknown) => utf8.encode(JSON.stringify(value));
const byName = (files: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

// Production keeps its last colours when lankametro.lk's fail; the previous routes file stands in for them.
const keepColours = (
  routes: ReadonlyArray<S.Route>,
  previous: ReadonlyMap<string, string>,
): ReadonlyArray<S.Route> =>
  routes.map((route) =>
    route.color_hex === undefined && previous.has(route.code)
      ? { ...route, color_hex: previous.get(route.code)! }
      : route,
  );

const firstOf = <A>(items: ReadonlyArray<A>, key: (item: A) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(key(item))) return false;
    seen.add(key(item));
    return true;
  });
};

const fetchAll = (
  upstream: ReferenceUpstreamShape,
  token: Token,
  colours: ReadonlyMap<string, string>,
) =>
  Effect.gen(function* () {
    const failed = new Set<string>();
    const built: Built[] = [];
    const add = (name: string, value: unknown) => {
      if (!built.some((item) => item.name === name))
        built.push({ name, body: encode(value), zip: false });
    };
    const attempt = <A>(
      name: string,
      effect: Effect.Effect<A, UpstreamError>,
    ) =>
      effect.pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          Effect.as(
            Effect.andThen(
              Effect.sync(() => void failed.add(name)),
              Effect.logWarning("reference fetch failed", name, error.message),
            ),
            Option.none<A>(),
          ),
        ),
      );

    const [fetched, places, occasions] = yield* Effect.all(
      [
        attempt(ReferenceName.routes, upstream.routes(token)),
        attempt(ReferenceName.places, upstream.places),
        attempt(ReferenceName.occasions, upstream.occasions),
      ],
      { concurrency: 3 },
    );
    if (Option.isSome(places)) add(ReferenceName.places, places.value);
    if (Option.isSome(occasions)) add(ReferenceName.occasions, occasions.value);
    const routes = Option.map(fetched, (list) => keepColours(list, colours));
    if (Option.isNone(routes)) return { built, failed, routes };
    add(ReferenceName.routes, routes.value);

    const directions = routes.value.flatMap((route, routeIndex) =>
      route.directions.map((direction, index) => ({
        route,
        routeIndex,
        direction,
        index,
      })),
    );
    const fetchedDirections = yield* Effect.forEach(
      directions,
      ({ route, direction, index }) =>
        Effect.gen(function* () {
          const stops = yield* attempt(
            ReferenceName.stops(route.code),
            upstream.stops(token, route, direction),
          );
          const geojson = yield* attempt(
            ReferenceName.path(route.code, direction.id),
            upstream.geometry(token, route, direction),
          );
          const shape = Option.map(
            geojson,
            (value): GtfsPath => ({
              code: route.code,
              directionIndex: index,
              geojson: value,
            }),
          );
          return { stops, shape };
        }),
      { concurrency: FETCH_CONCURRENCY },
    );

    const perRoute = routes.value.map((route, routeIndex) => {
      const own = fetchedDirections.filter(
        (_, at) => directions[at].routeIndex === routeIndex,
      );
      const stops = Option.all(own.map((entry) => entry.stops));
      if (Option.isSome(stops))
        add(
          ReferenceName.stops(route.code),
          route.directions.map((direction, index) => ({
            route_code: route.code,
            route_name: route.name,
            direction_id: direction.id,
            direction_label: `${direction.start_location} -> ${direction.end_location}`,
            stops: stops.value[index],
          })),
        );
      route.directions.forEach((direction, index) => {
        const shape = own[index].shape;
        if (Option.isSome(shape))
          add(
            ReferenceName.path(route.code, direction.id),
            shape.value.geojson,
          );
      });
      return { stops, shapes: Option.all(own.map((entry) => entry.shape)) };
    });

    const stops = Option.all(perRoute.map((entry) => entry.stops));
    const shapes = Option.all(perRoute.map((entry) => entry.shapes));
    if (Option.isSome(stops))
      add(ReferenceName.stopIds, stopIdsByCode(stops.value.flat()));
    if (Option.isSome(stops) && Option.isSome(shapes)) {
      const archive = yield* attempt(
        ReferenceName.gtfs,
        Effect.tryPromise({
          try: () =>
            buildStaticGtfs({
              routes: firstOf(routes.value, (route) => route.code),
              stops: stops.value.flat(2),
              paths: firstOf(
                shapes.value.flat(),
                (path) => `${path.code}\u0000${path.directionIndex}`,
              ),
            }),
          catch: () => new UpstreamError({ message: "static GTFS not built" }),
        }),
      );
      if (Option.isSome(archive))
        built.push({
          name: ReferenceName.gtfs,
          body: archive.value,
          zip: true,
        });
    }
    return { built, failed, routes };
  });

const failingAlert = (count: number, failed: ReadonlyArray<string>) => ({
  urgent: true,
  title: "Reference data: updates failing",
  message: `The hourly reference update has failed ${count} times in a row (${failed.join(", ")}). The site keeps serving the last good files.`,
});

const recoveredAlert = {
  title: "Reference data: updates recovered",
  message: "The hourly reference update succeeded again.",
};

export const makeReferencePublisher = ({
  store,
  upstream,
  book,
  token,
}: PublisherDeps) =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1);

    const readStored = <A>(key: string, schema: Schema.Codec<A, unknown>) =>
      store
        .get(key)
        .pipe(
          Effect.map(
            Option.flatMap((object) =>
              Option.flatMap(
                parseJson(new TextDecoder().decode(object.body)),
                Schema.decodeUnknownOption(schema),
              ),
            ),
          ),
        );

    const lastStatus = readStored(STATUS_KEY, ReferenceStatus).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined),
    );

    const settle = (failed: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const last = yield* lastStatus;
        const ok = failed.length === 0;
        const status: ReferenceStatus = {
          checked_at: now,
          ok,
          failed: [...failed].sort(),
          consecutive_failures: ok ? 0 : (last?.consecutive_failures ?? 0) + 1,
          last_success_at: ok ? now : (last?.last_success_at ?? null),
        };
        yield* store
          .put(STATUS_KEY, encode(status), {
            contentType: "application/json",
            cacheControl: STATUS_CACHE,
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("reference status not written", error.message),
            ),
          );
        if (status.consecutive_failures >= ALERT_AFTER_FAILURES)
          yield* book.raise(
            "reference_failing",
            failingAlert(status.consecutive_failures, status.failed),
          );
        else if (ok) yield* book.resolve("reference_failing", recoveredAlert);
        return status;
      });

    const publish = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const previous = yield* readStored(MANIFEST_KEY, Manifest);
      const before: Readonly<Record<string, string>> = Option.match(previous, {
        onNone: () => ({}),
        onSome: (manifest) => manifest.files,
      });
      const previousRoutes = Object.hasOwn(before, ReferenceName.routes)
        ? yield* readStored(before[ReferenceName.routes], RoutesFile)
        : Option.none();
      const colours = new Map(
        Option.getOrElse(previousRoutes, () => []).flatMap((route) =>
          route.color_hex === undefined ? [] : [[route.code, route.color_hex]],
        ),
      );
      const { built, failed, routes } = yield* fetchAll(
        upstream,
        yield* token,
        colours,
      );
      if (
        failed.has(ReferenceName.occasions) &&
        !Object.hasOwn(before, ReferenceName.occasions)
      )
        built.push({
          name: ReferenceName.occasions,
          body: encode(FALLBACK_OCCASIONS),
          zip: false,
        });

      const files: Record<string, string> = { ...before };
      if (Option.isSome(routes)) {
        const listed = new Set(routes.value.map((route) => route.code));
        const paths = new Set(
          routes.value.flatMap((route) =>
            route.directions.map((direction) =>
              ReferenceName.path(route.code, direction.id),
            ),
          ),
        );
        for (const name of Object.keys(files)) {
          const [kind, code] = name.split("/");
          if (
            (kind === "stops" && !listed.has(code)) ||
            (kind === "paths" && !paths.has(name))
          )
            delete files[name];
        }
      }

      const written: string[] = [];
      for (const item of built) {
        const hash = yield* Effect.promise(() => sha256Hex(item.body));
        const key = versionedKey(item.name, hash, item.zip ? "zip" : "json");
        if (before[item.name] !== key) {
          yield* store.put(key, item.body, {
            contentType: item.zip ? "application/zip" : "application/json",
            cacheControl: VERSIONED_CACHE,
          });
          written.push(key);
        }
        files[item.name] = key;
      }

      const next = byName(files);
      if (JSON.stringify(next) !== JSON.stringify(byName(before))) {
        yield* store.put(
          MANIFEST_KEY,
          encode({ version: 1, updated_at: now, files: next }),
          { contentType: "application/json", cacheControl: MANIFEST_CACHE },
        );
        written.push(MANIFEST_KEY);
      }

      const status = yield* settle([...failed]);
      const report: PublishReport = {
        ok: status.ok,
        failed: status.failed,
        written,
      };
      return report;
    });

    const unfinished = (reason: "timeout" | "store") => {
      const report: PublishReport = {
        ok: false,
        failed: [reason],
        written: [],
      };
      return Effect.as(settle(report.failed), report);
    };

    const bounded = publish.pipe(
      Effect.timeout(RUN_TIMEOUT_MS),
      Effect.catchTag("TimeoutError", () =>
        Effect.andThen(
          Effect.logWarning("reference publish timed out"),
          unfinished("timeout"),
        ),
      ),
      Effect.catchTag("StoreError", (error) =>
        Effect.andThen(
          Effect.logWarning("reference publish failed", error.message),
          unfinished("store"),
        ),
      ),
    );

    const due = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const status = yield* readStored(STATUS_KEY, ReferenceStatus).pipe(
        Effect.orElseSucceed(() => Option.none()),
      );
      const elapsed = Option.match(status, {
        onNone: () => true,
        onSome: (last) =>
          now < last.checked_at || now - last.checked_at >= PUBLISH_EVERY_MS,
      });
      if (!elapsed) {
        const published = yield* readStored(MANIFEST_KEY, Manifest).pipe(
          Effect.map(
            Option.match({
              onNone: () => false,
              onSome: (manifest) =>
                Object.hasOwn(manifest.files, ReferenceName.routes),
            }),
          ),
          Effect.orElseSucceed(() => true),
        );
        if (published) return false;
      }
      // A run before the first login could only fail, and its status would hold off the next one for an hour.
      return !upstream.needsLogin || Option.isSome(yield* token);
    });

    const shape: ReferencePublisherShape = {
      run: lock.withPermits(1)(bounded),
      runIfDue: lock.withPermits(1)(
        Effect.gen(function* () {
          return (yield* due)
            ? Option.some(yield* bounded)
            : Option.none<PublishReport>();
        }),
      ),
    };
    return shape;
  });

export class ReferencePublisher extends Context.Service<
  ReferencePublisher,
  ReferencePublisherShape
>()("metro/ReferencePublisher") {
  static readonly layer = Layer.effect(
    ReferencePublisher,
    Effect.gen(function* () {
      const fleet = yield* Fleet;
      return yield* makeReferencePublisher({
        store: yield* ObjectStore,
        upstream: yield* ReferenceUpstream,
        book: yield* AlertBook,
        token: fleet.token,
      });
    }),
  );
}
