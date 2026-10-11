import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Clock, Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { createServer } from "node:http";
import path from "node:path";
import { Auth } from "./auth.js";
import { ServerConfig } from "./config.js";
import { LiveFleet } from "./live-fleet.js";
import { directionMatches, isIsoDate, isStopUuid } from "./params.js";
import type * as S from "./schemas.js";
import { UpstreamApi, type UpstreamError } from "./upstream.js";

class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", {
  message: Schema.String,
}) {}

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  message: Schema.String,
}) {}

type ApiError = BadRequest | NotFound | UpstreamError | Schema.SchemaError;

const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status });

// How long browsers (and a CDN set to cache /api) may reuse a response: fresh
// for a while, then used while a fresh copy is fetched behind it. Reference
// data changes a few times a day at most; errors and live data aren't reused.
const CACHE = {
  reference: "public, max-age=3600, stale-while-revalidate=86400",
  geometry: "public, max-age=86400, stale-while-revalidate=604800",
  none: "no-store",
} as const;

const noStore = HttpServerResponse.setHeader("cache-control", CACHE.none);

const respond = <A, R>(
  handler: Effect.Effect<A, ApiError, R>,
  cacheControl: string = CACHE.none,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  handler.pipe(
    Effect.map((body) =>
      HttpServerResponse.setHeader(json(body), "cache-control", cacheControl),
    ),
    Effect.catchDefect((defect) =>
      Effect.logError("unexpected failure", defect).pipe(
        Effect.as(json({ error: "internal error" }, 500)),
      ),
    ),
    Effect.catch((error) => {
      switch (error._tag) {
        case "BadRequest":
          return Effect.succeed(json({ error: error.message }, 400));
        case "SchemaError":
          return Effect.succeed(
            json({ error: "invalid query parameters" }, 400),
          );
        case "NotFound":
          return Effect.succeed(json({ error: error.message }, 404));
        case "UpstreamError":
          return Effect.logWarning("upstream request failed", error.cause).pipe(
            Effect.as(
              json({ error: "transit data is temporarily unavailable" }, 502),
            ),
          );
      }
    }),
    Effect.map((response) =>
      response.status >= 400 ? noStore(response) : response,
    ),
  );

const DirectionQuery = Schema.Struct({
  direction: Schema.optional(Schema.String),
});

const requestedDirection = HttpServerRequest.schemaSearchParams(
  DirectionQuery,
).pipe(Effect.map((query) => query.direction));

const invalidDirection = (route: S.Route) =>
  new BadRequest({ message: `invalid direction for ${route.code}` });

const findRoute = Effect.fnUntraced(function* () {
  const { code = "" } = yield* HttpRouter.params;
  const routes = yield* (yield* UpstreamApi).routes;
  const route = routes.find((r) => r.code.toLowerCase() === code.toLowerCase());
  if (!route)
    return yield* new NotFound({ message: `route not found: ${code}` });
  return route;
});

const resolveStopId = Effect.fnUntraced(function* (ref: string) {
  if (isStopUuid(ref)) return ref;
  const stopId = (yield* (yield* UpstreamApi).stopIdsByCode).get(ref);
  if (!stopId)
    return yield* new BadRequest({ message: `unknown stop: ${ref}` });
  return stopId;
});

// Asia/Colombo is UTC+5:30
const COLOMBO_UTC_OFFSET_MS = 5.5 * 3_600_000;

const todayInColombo = Clock.currentTimeMillis.pipe(
  Effect.map((now) =>
    new Date(now + COLOMBO_UTC_OFFSET_MS).toISOString().slice(0, 10),
  ),
);

const healthHandler = Effect.gen(function* () {
  const api = yield* UpstreamApi;
  return yield* api.routes.pipe(
    Effect.match({
      onFailure: () =>
        json({ ok: false, routes_count: null, upstream: "unreachable" }),
      onSuccess: (routes) =>
        json({ ok: true, routes_count: routes.length, upstream: "reachable" }),
    }),
    Effect.map(noStore),
  );
});

const routesHandler = respond(
  Effect.gen(function* () {
    return { routes: yield* (yield* UpstreamApi).routes };
  }),
  CACHE.reference,
);

const routeHandler = respond(findRoute(), CACHE.reference);

const geometryHandler = respond(
  Effect.gen(function* () {
    const api = yield* UpstreamApi;
    const route = yield* findRoute();
    const direction = yield* requestedDirection;
    const selected =
      direction === undefined
        ? route.directions[0]
        : route.directions.find((d, i) => directionMatches(direction, d, i));
    if (!selected) return yield* invalidDirection(route);
    return yield* api.geometry(selected.geojson_url);
  }),
  CACHE.geometry,
);

const stopsHandler = respond(
  Effect.gen(function* () {
    const api = yield* UpstreamApi;
    const route = yield* findRoute();
    const direction = yield* requestedDirection;
    const selected = route.directions.filter(
      (d, i) => direction === undefined || directionMatches(direction, d, i),
    );
    if (selected.length === 0) return yield* invalidDirection(route);
    const results: ReadonlyArray<S.RouteStops> = yield* Effect.forEach(
      selected,
      (d) =>
        api.stopsFor(route.id, d.id).pipe(
          Effect.map((stops) => ({
            route_code: route.code,
            route_name: route.name,
            direction_id: d.id,
            direction_label: `${d.start_location} -> ${d.end_location}`,
            stops,
          })),
        ),
      { concurrency: "unbounded" },
    );
    return results.length === 1 ? results[0] : { directions: results };
  }),
  CACHE.reference,
);

const JourneyQuery = Schema.Struct({
  from: Schema.NonEmptyString,
  to: Schema.NonEmptyString,
  date: Schema.optional(Schema.String),
});

const journeyHandler = respond(
  Effect.gen(function* () {
    const api = yield* UpstreamApi;
    const query = yield* HttpServerRequest.schemaSearchParams(
      JourneyQuery,
    ).pipe(
      Effect.mapError(
        () =>
          new BadRequest({
            message: "`from` and `to` (stop_code or stop uuid) are required",
          }),
      ),
    );
    const date = query.date ?? (yield* todayInColombo);
    if (!isIsoDate(date)) {
      return yield* new BadRequest({ message: "`date` must be YYYY-MM-DD" });
    }
    const [from, to] = yield* Effect.all([
      resolveStopId(query.from),
      resolveStopId(query.to),
    ]);
    // Pass on the upstream's reason for rejecting a query (e.g. a past date).
    return yield* api.journey(from, to, date).pipe(
      Effect.catchIf(
        (error) => error.status === 400 && error.detail !== undefined,
        (error) => Effect.fail(new BadRequest({ message: error.detail! })),
      ),
    );
  }),
  // The default date is "today", and today's plans carry live estimates.
  CACHE.none,
);

const placesHandler = respond(
  Effect.gen(function* () {
    return { places: yield* (yield* UpstreamApi).places };
  }),
  CACHE.reference,
);

const liveHandler = Effect.gen(function* () {
  return noStore(json(yield* (yield* LiveFleet).snapshot));
});

const ApiRoutes = HttpRouter.addAll(
  [
    HttpRouter.route("GET", "/health", healthHandler),
    HttpRouter.route("GET", "/routes", routesHandler),
    HttpRouter.route("GET", "/routes/:code", routeHandler),
    HttpRouter.route("GET", "/routes/:code/geometry", geometryHandler),
    HttpRouter.route("GET", "/routes/:code/stops", stopsHandler),
    HttpRouter.route("GET", "/journey", journeyHandler),
    HttpRouter.route("GET", "/live", liveHandler),
    HttpRouter.route("GET", "/places", placesHandler),
    HttpRouter.route(
      "*",
      "/*",
      Effect.sync(() => json({ error: "not found" }, 404)),
    ),
  ],
  { prefix: "/api" },
);

const WebRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const { webDist } = yield* ServerConfig;
    const root = path.resolve(webDist);
    return Layer.mergeAll(
      HttpStaticServer.layer({
        root: path.join(root, "assets"),
        prefix: "/assets",
        cacheControl: "public, max-age=31536000, immutable",
      }),
      HttpStaticServer.layer({ root, spa: true, cacheControl: "no-cache" }),
    );
  }),
);

const HttpLive = Layer.unwrap(
  Effect.gen(function* () {
    const { port, host } = yield* ServerConfig;
    return NodeHttpServer.layer(createServer, { port, host });
  }),
);

const App = LiveFleet.layer.pipe(
  Layer.provideMerge(UpstreamApi.layer),
  Layer.provideMerge(Auth.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

const Main = HttpRouter.serve(
  Layer.mergeAll(
    ApiRoutes,
    WebRoutes,
    HttpRouter.cors({ allowedMethods: ["GET"] }),
  ),
).pipe(Layer.provide([App, HttpLive]));

Layer.launch(Main).pipe(NodeRuntime.runMain);
