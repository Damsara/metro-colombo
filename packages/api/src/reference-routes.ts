import { Clock, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import {
  colomboDay,
  directionMatches,
  FALLBACK_OCCASIONS,
  OccasionsFile,
  PlacesFile,
  ReferenceName,
  RoutesFile,
  type S,
  StopsFile,
  upcomingFrom,
} from "@metro/core";
import { ReferenceMissing, ReferenceReader } from "./reader.js";
import { BadRequest, CACHE, json, NotFound, respond } from "./responses.js";

const DirectionQuery = Schema.Struct({
  direction: Schema.optional(Schema.String),
});

const requestedDirection = HttpServerRequest.schemaSearchParams(
  DirectionQuery,
).pipe(Effect.map((query) => query.direction));

const invalidDirection = (route: S.Route) =>
  new BadRequest({ message: `invalid direction for ${route.code}` });

export const ReferenceRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const reader = yield* ReferenceReader;
    const clock = yield* Clock.Clock;
    const routes = reader.typed(ReferenceName.routes, RoutesFile);

    const findRoute = Effect.gen(function* () {
      const { code = "" } = yield* HttpRouter.params;
      const route = (yield* routes).find(
        (candidate) => candidate.code.toLowerCase() === code.toLowerCase(),
      );
      if (!route)
        return yield* new NotFound({ message: `route not found: ${code}` });
      return route;
    });

    const geometry = Effect.gen(function* () {
      const route = yield* findRoute;
      const direction = yield* requestedDirection;
      const selected =
        direction === undefined
          ? route.directions[0]
          : route.directions.find((d, i) => directionMatches(direction, d, i));
      if (!selected) return yield* invalidDirection(route);
      return yield* reader.typed(
        ReferenceName.path(route.code, selected.id),
        Schema.Unknown,
      );
    });

    const stops = Effect.gen(function* () {
      const route = yield* findRoute;
      const direction = yield* requestedDirection;
      const selected = route.directions.filter(
        (d, i) => direction === undefined || directionMatches(direction, d, i),
      );
      if (selected.length === 0) return yield* invalidDirection(route);
      const file = yield* reader.typed(
        ReferenceName.stops(route.code),
        StopsFile,
      );
      const results = yield* Effect.forEach(selected, (d) => {
        const found = file.find((entry) => entry.direction_id === d.id);
        return found
          ? Effect.succeed(found)
          : Effect.fail(
              new ReferenceMissing({
                message: `no stops for ${route.code} ${d.id}`,
              }),
            );
      });
      return results.length === 1 ? results[0] : { directions: results };
    });

    const occasions = Effect.gen(function* () {
      const all = yield* reader
        .typed(ReferenceName.occasions, OccasionsFile)
        .pipe(
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning(
                "published occasions unavailable, using the built-in list",
                error.message,
              ),
              FALLBACK_OCCASIONS,
            ),
          ),
        );
      return {
        occasions: upcomingFrom(
          all,
          colomboDay(clock.currentTimeMillisUnsafe()),
        ),
      };
    });

    const places = Effect.map(
      reader.typed(ReferenceName.places, PlacesFile),
      (list) => ({ places: list }),
    );

    return HttpRouter.addAll(
      [
        HttpRouter.route(
          "GET",
          "/routes",
          respond(
            Effect.map(routes, (list) => ({ routes: list })),
            CACHE.reference,
          ),
        ),
        HttpRouter.route(
          "GET",
          "/routes/:code",
          respond(findRoute, CACHE.reference),
        ),
        HttpRouter.route(
          "GET",
          "/routes/:code/geometry",
          respond(geometry, CACHE.geometry),
        ),
        HttpRouter.route(
          "GET",
          "/routes/:code/stops",
          respond(stops, CACHE.reference),
        ),
        HttpRouter.route("GET", "/places", respond(places, CACHE.reference)),
        HttpRouter.route(
          "GET",
          "/occasions",
          respond(occasions, CACHE.reference),
        ),
        HttpRouter.route(
          "*",
          "/*",
          Effect.sync(() => json({ error: "not found" }, 404)),
        ),
      ],
      { prefix: "/api" },
    );
  }),
);
