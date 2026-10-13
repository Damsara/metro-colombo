import { Effect, Layer, Predicate, Schema } from "effect";
import { HttpClient } from "effect/http";
import { OccasionsFile, PlacesFile, RoutesFile, S } from "@metro/core";
import { ProxyConfig } from "./config.js";
import { checkedAs, fetchJson } from "./http-json.js";
import { ReferenceUpstream } from "./reference.js";

// Production only turns a 400's message into the caller's error.
const proxyDetail = (body: unknown, status: number) =>
  status === 400 &&
  Predicate.isObject(body) &&
  typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error.slice(0, 200)
    : undefined;

const RoutesBody = Schema.Struct({ routes: RoutesFile });
const PlacesBody = Schema.Struct({ places: PlacesFile });
const OccasionsBody = Schema.Struct({ occasions: OccasionsFile });

export const ProxyUpstream = Layer.effect(
  ReferenceUpstream,
  Effect.gen(function* () {
    const base = (yield* ProxyConfig).replace(/\/+$/, "");
    const http = yield* HttpClient.HttpClient;
    const get = (path: string) =>
      fetchJson(http, `${base}${path}`, { detail: proxyDetail });
    const routePath = (route: S.Route, direction: S.Direction, what: string) =>
      `/api/routes/${encodeURIComponent(route.code)}/${what}?${new URLSearchParams({ direction: direction.id })}`;

    return ReferenceUpstream.of({
      needsLogin: false,
      routes: () =>
        get("/api/routes").pipe(
          Effect.flatMap(checkedAs(RoutesBody)),
          Effect.map((body) => body.routes),
        ),
      stops: (_token, route, direction) =>
        get(routePath(route, direction, "stops")).pipe(
          Effect.flatMap(checkedAs(S.RouteStops)),
          Effect.map((body) => body.stops),
        ),
      geometry: (_token, route, direction) =>
        get(routePath(route, direction, "geometry")),
      places: get("/api/places").pipe(
        Effect.flatMap(checkedAs(PlacesBody)),
        Effect.map((body) => body.places),
      ),
      occasions: get("/api/occasions").pipe(
        Effect.flatMap(checkedAs(OccasionsBody)),
        Effect.map((body) => body.occasions),
      ),
      journey: (_token, from, to, date) =>
        get(`/api/journey?${new URLSearchParams({ from, to, date })}`).pipe(
          Effect.flatMap(checkedAs(S.JourneyPlan)),
        ),
    });
  }),
);
