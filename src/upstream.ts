import {
  Cache,
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Redacted,
  Schema,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { Auth, countFallback, countRequest, type Endpoint } from "./auth.js";
import { UpstreamConfig } from "./config.js";
import * as S from "./schemas.js";

export class UpstreamError extends Schema.TaggedError<UpstreamError>()(
  "UpstreamError",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
    detail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const UpstreamErrorBody = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});

const EimskyRoutesResponse = Schema.Struct({
  data: Schema.Struct({ routes: Schema.Array(S.Route) }),
});

const LkRoutesResponse = Schema.Struct({
  routes: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      color_hex: Schema.String,
    }),
  ),
});

const StopsResponse = Schema.Struct({
  data: Schema.Struct({ stops: Schema.Array(S.Stop) }),
});

const JourneyResponse = Schema.Struct({ data: S.JourneyPlan });

const REQUEST_TIMEOUT = Duration.seconds(15);
const FAILURE_RETRY_AFTER = Duration.seconds(2);

// lankametro.lk numbers its stops itself, so `/api/stops` maps those numbers to the MetroBus stop code and id.
const LkPlacesResponse = Schema.Struct({
  places: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      name_si: Schema.String,
      name_ta: Schema.String,
      category: Schema.String,
      nearest_stop_id: Schema.Number,
      walk_meters: Schema.Number,
    }),
  ),
});
type LkPlace = (typeof LkPlacesResponse.Type)["places"][number];

const LkStopsResponse = Schema.Struct({
  stops: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      stop_code: Schema.String,
      eimsky_id: Schema.String,
    }),
  ),
});
type LkStop = (typeof LkStopsResponse.Type)["stops"][number];

export function linkPlaces(
  places: ReadonlyArray<LkPlace>,
  stops: ReadonlyArray<LkStop>,
): ReadonlyArray<S.Place> {
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  return places.flatMap(({ nearest_stop_id, ...place }) => {
    const stop = byId.get(nearest_stop_id);
    return stop
      ? [
          {
            ...place,
            name: place.name.trim(),
            stop_code: stop.stop_code,
            stop_id: stop.eimsky_id,
          },
        ]
      : [];
  });
}

// Stale values are served at once while one background refresh runs; past `serveStaleFor` requests wait on the origin and use the old value only if it errors.
export const staleCache = Effect.fnUntraced(function* <A>(
  lookup: (key: string) => Effect.Effect<A, UpstreamError>,
  options: {
    readonly name: string;
    readonly freshTtl: Duration.Input;
    readonly staleTtl: Duration.Input;
    readonly serveStaleFor?: Duration.Input;
    readonly capacity: number;
  },
) {
  // Holds a failure for 2s so a struggling origin isn't hammered.
  const cache = yield* Cache.makeWith(lookup, {
    capacity: options.capacity,
    timeToLive: (exit) =>
      Exit.isSuccess(exit) ? options.freshTtl : FAILURE_RETRY_AFTER,
  });
  const freshMillis = Duration.toMillis(
    Duration.fromInputUnsafe(options.freshTtl),
  );
  const staleMillis = Duration.toMillis(
    Duration.fromInputUnsafe(options.staleTtl),
  );
  const serveStaleMillis = Duration.toMillis(
    Duration.fromInputUnsafe(options.serveStaleFor ?? options.staleTtl),
  );
  // Insertion-ordered. First key is the least recently refreshed.
  const lastGood = new Map<
    string,
    { readonly value: A; readonly at: number }
  >();
  const refreshing = new Set<string>();

  const remember = (key: string, value: A, at: number) => {
    lastGood.delete(key);
    lastGood.set(key, { value, at });
    if (lastGood.size > options.capacity) {
      lastGood.delete(lastGood.keys().next().value!);
    }
  };

  const fetch = (key: string) =>
    Effect.gen(function* () {
      const value = yield* Cache.get(cache, key);
      const now = yield* Clock.currentTimeMillis;
      if (lastGood.get(key)?.value !== value) remember(key, value, now);
      return value;
    });

  const answered = (result: string) =>
    Effect.annotateCurrentSpan("cache.result", result);

  return (key: string): Effect.Effect<A, UpstreamError> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const previous = lastGood.get(key);
      if (previous)
        yield* Effect.annotateCurrentSpan("cache.age_ms", now - previous.at);
      if (!previous || now - previous.at > staleMillis) {
        yield* answered(previous ? "expired" : "miss");
        return yield* fetch(key);
      }
      if (now - previous.at > serveStaleMillis) {
        const result = yield* Effect.exit(fetch(key));
        yield* answered(Exit.isSuccess(result) ? "waited" : "fallback");
        return Exit.isSuccess(result) ? result.value : previous.value;
      }
      if (now - previous.at < freshMillis) {
        yield* answered("fresh");
        return previous.value;
      }
      yield* answered("stale");
      if (!refreshing.has(key)) {
        refreshing.add(key);
        yield* fetch(key).pipe(
          Effect.withSpan(`cache.${options.name}.refresh`),
          Effect.ignore,
          Effect.ensuring(Effect.sync(() => refreshing.delete(key))),
          Effect.forkDetach,
        );
      }
      return previous.value;
    }).pipe(
      Effect.withSpan(`cache.${options.name}`, {
        attributes: { "cache.key": key },
      }),
    );
});

export class UpstreamApi extends Context.Service<
  UpstreamApi,
  {
    readonly routes: Effect.Effect<ReadonlyArray<S.Route>, UpstreamError>;
    readonly stopsFor: (
      routeId: string,
      directionId: string,
    ) => Effect.Effect<ReadonlyArray<S.Stop>, UpstreamError>;
    readonly stopIdsByCode: Effect.Effect<
      ReadonlyMap<string, string>,
      UpstreamError
    >;
    readonly journey: (
      fromStopId: string,
      toStopId: string,
      date: string,
    ) => Effect.Effect<S.JourneyPlan, UpstreamError>;
    readonly places: Effect.Effect<ReadonlyArray<S.Place>, UpstreamError>;
    readonly geometry: (
      geojsonUrl: string,
    ) => Effect.Effect<unknown, UpstreamError>;
  }
>()("lmt-go/UpstreamApi") {
  static readonly layer = Layer.effect(
    UpstreamApi,
    Effect.gen(function* () {
      const config = yield* UpstreamConfig;
      const http = yield* HttpClient.HttpClient;
      const auth = yield* Auth;
      const fareApi = `${config.eimskyBase}/fare-service/api/v1`;

      const getJson = Effect.fn("UpstreamApi.getJson")(
        function* <A>(
          schema: Schema.Codec<A, unknown>,
          endpoint: Endpoint,
          url: string,
          headers: Record<string, string> = {},
        ) {
          return yield* Effect.gen(function* () {
            const response = yield* http
              .get(url, { headers })
              .pipe(Effect.tapError(() => countRequest(endpoint, "transport")));
            const ok = response.status >= 200 && response.status < 300;
            if (!ok) {
              yield* countRequest(endpoint, "http_error");
              const detail = yield* HttpClientResponse.schemaBodyJson(
                UpstreamErrorBody,
              )(response).pipe(
                Effect.map((body) => body.error.message),
                Effect.orElseSucceed(() => undefined),
              );
              return yield* new UpstreamError({
                message: `Upstream responded with HTTP ${response.status}`,
                status: response.status,
                detail,
              });
            }
            const body = yield* HttpClientResponse.schemaBodyJson(schema)(
              response,
            ).pipe(
              Effect.tapError((error) =>
                countRequest(
                  endpoint,
                  Schema.isSchemaError(error) ? "decode_error" : "transport",
                ),
              ),
            );
            yield* countRequest(endpoint, "ok");
            return body;
          }).pipe(
            Effect.timeout(REQUEST_TIMEOUT),
            Effect.tapError((error) =>
              Cause.isTimeoutError(error)
                ? countRequest(endpoint, "timeout")
                : Effect.void,
            ),
          );
        },
        Effect.mapError((cause) =>
          cause instanceof UpstreamError
            ? cause
            : new UpstreamError({
                message: "Upstream request failed",
                cause,
              }),
        ),
      );

      const getAuthed = Effect.fn("UpstreamApi.getAuthed")(function* <A>(
        schema: Schema.Codec<A, unknown>,
        endpoint: Endpoint,
        url: string,
      ) {
        const token = yield* auth.currentToken.pipe(
          Effect.mapError(
            (error) =>
              new UpstreamError({
                message: error.message,
                status: 502,
                cause: error,
              }),
          ),
        );
        return yield* getJson(schema, endpoint, url, {
          authorization: `Bearer ${Redacted.value(token)}`,
        });
      });

      const fetchRoutes = getAuthed(
        EimskyRoutesResponse,
        "routes",
        `${fareApi}/routes/geo`,
      ).pipe(
        Effect.map((r) => r.data.routes),
        Effect.withSpan("UpstreamApi.routes"),
      );

      const fetchColours = getJson(
        LkRoutesResponse,
        "colours",
        `${config.lankametroBase}/api/routes`,
      ).pipe(
        Effect.map(
          (r) =>
            new Map(r.routes.map((route) => [route.code, route.color_hex])),
        ),
        Effect.withSpan("UpstreamApi.colours"),
      );

      const fetchStops = Effect.fn("UpstreamApi.stopsFor")(function* (
        routeId: string,
        directionId: string,
      ) {
        const r = yield* getAuthed(
          StopsResponse,
          "stops",
          `${fareApi}/routes/${encodeURIComponent(routeId)}/stops?${new URLSearchParams({ direction_id: directionId })}`,
        );
        // Upstream names often arrive with stray spaces and newlines attached.
        return r.data.stops.map((stop) => ({
          ...stop,
          stop_name_en: stop.stop_name_en.trim(),
          stop_name_si: stop.stop_name_si.trim(),
          stop_name_tm: stop.stop_name_tm.trim(),
        }));
      });

      const fetchJourney = Effect.fn("UpstreamApi.journey")(function* (
        from: string,
        to: string,
        date: string,
      ) {
        const { data } = yield* getAuthed(
          JourneyResponse,
          "journey",
          `${fareApi}/journeys/plan?${new URLSearchParams({ from_stop_id: from, to_stop_id: to, date })}`,
        );
        // `option_token` is for booking, which this API does not offer.
        return {
          ...data,
          options: data.options.map(({ option_token: _, ...option }) => option),
        };
      });

      const fetchPlaces = Effect.all(
        [
          getJson(
            LkPlacesResponse,
            "places",
            `${config.lankametroBase}/api/places`,
          ),
          getJson(
            LkStopsResponse,
            "places",
            `${config.lankametroBase}/api/stops`,
          ),
        ],
        { concurrency: 2 },
      ).pipe(
        Effect.map(([places, stops]) => linkPlaces(places.places, stops.stops)),
        Effect.withSpan("UpstreamApi.places"),
      );

      // Route GeoJSON lives on Google Cloud Storage, which lankametro.lk proxies when direct access fails; only GCS URLs are fetched.
      const GCS = "https://storage.googleapis.com/";
      const fetchGeometry = Effect.fn("UpstreamApi.geometry")(function* (
        url: string,
      ) {
        if (!url.startsWith(GCS)) {
          return yield* new UpstreamError({
            message: `unexpected geometry URL: ${url}`,
          });
        }
        return yield* getJson(Schema.Unknown, "geometry", url).pipe(
          Effect.catch(() =>
            getJson(
              Schema.Unknown,
              "geometry",
              `${config.lankametroBase}/gcs-proxy/${url.slice(GCS.length)}`,
            ),
          ),
        );
      });

      // Reference data is cached for hours and served stale for days to ride out upstream outages; journeys change by the minute.
      const routes = yield* staleCache(() => fetchRoutes, {
        name: "routes",
        freshTtl: Duration.hours(12),
        staleTtl: Duration.days(7),
        capacity: 1,
      });
      // Kept apart from routes so one failed lookup doesn't leave every route uncoloured.
      const colours = yield* staleCache(() => fetchColours, {
        name: "colours",
        freshTtl: Duration.hours(12),
        staleTtl: Duration.days(7),
        capacity: 1,
      });
      const stops = yield* staleCache(
        (key) => {
          const [routeId, directionId] = key.split("|");
          return fetchStops(routeId, directionId);
        },
        {
          name: "stops",
          freshTtl: Duration.hours(12),
          staleTtl: Duration.days(7),
          capacity: 64,
        },
      );
      const journey = yield* staleCache(
        (key) => {
          const [from, to, date] = key.split("|");
          return fetchJourney(from, to, date);
        },
        {
          name: "journey",
          freshTtl: Duration.seconds(60),
          // Today's plans have live ETAs, don't hand out old ones for long.
          serveStaleFor: Duration.minutes(2),
          staleTtl: Duration.minutes(10),
          capacity: 128,
        },
      );
      const places = yield* staleCache(() => fetchPlaces, {
        name: "places",
        freshTtl: Duration.hours(24),
        staleTtl: Duration.days(7),
        capacity: 1,
      });
      const geometry = yield* staleCache(fetchGeometry, {
        name: "geometry",
        freshTtl: Duration.hours(24),
        staleTtl: Duration.days(30),
        capacity: 32,
      });

      const stopsFor = (routeId: string, directionId: string) =>
        stops(`${routeId}|${directionId}`);

      // Built from the caches on each call, so a stop list that failed to load earlier is picked up once it succeeds.
      const stopIdsByCode = Effect.gen(function* () {
        const directions = (yield* routes("all")).flatMap((route) =>
          route.directions.map((direction) => ({ route, direction })),
        );
        const lists = yield* Effect.forEach(
          directions,
          ({ route, direction }) =>
            stopsFor(route.id, direction.id).pipe(
              Effect.tapError(() => countFallback("stops")),
              Effect.orElseSucceed((): ReadonlyArray<S.Stop> => []),
            ),
          { concurrency: 8 },
        );
        return new Map(lists.flat().map((stop) => [stop.stop_code, stop.id]));
      }).pipe(Effect.withSpan("UpstreamApi.stopIdsByCode"));

      const colouredRoutes = Effect.gen(function* () {
        const list = yield* routes("all");
        const byCode = yield* colours("all").pipe(
          Effect.timeout(Duration.seconds(3)),
          Effect.tapError((error) =>
            Effect.andThen(
              countFallback("colours"),
              Effect.logWarning("route colours unavailable", error),
            ),
          ),
          Effect.orElseSucceed(() => new Map<string, string>()),
        );
        return list.map((route) => ({
          ...route,
          color_hex: byCode.get(route.code) ?? route.color_hex,
        }));
      }).pipe(Effect.withSpan("UpstreamApi.colouredRoutes"));

      return UpstreamApi.of({
        routes: colouredRoutes,
        stopsFor,
        stopIdsByCode,
        journey: (from, to, date) => journey(`${from}|${to}|${date}`),
        places: places("all"),
        geometry,
      });
    }),
  );
}
