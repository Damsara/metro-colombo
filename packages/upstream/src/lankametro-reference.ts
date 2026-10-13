import { Clock, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient } from "effect/http";
import {
  addDays,
  colomboDay,
  colourRoutes,
  linkPlaces,
  parseIcs,
  S,
  toOccasions,
} from "@metro/core";
import { LankaMetroConfig, ReferenceConfig } from "./config.js";
import { decodeWith, fetchJson, fetchText } from "./http-json.js";
import { ReferenceUpstream, type Token, UpstreamError } from "./reference.js";

// Warn this long before the holiday feed runs out, while there's time to find a new one.
const FEED_ENDING_DAYS = 60;
// Route GeoJSON lives on Google Cloud Storage, which lankametro.lk proxies when direct access fails.
const GCS = "https://storage.googleapis.com/";

const EimskyError = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});
const eimskyDetail = (body: unknown) =>
  Option.getOrUndefined(
    Option.map(
      Schema.decodeUnknownOption(EimskyError)(body),
      (decoded) => decoded.error.message,
    ),
  );

const RoutesResponse = Schema.Struct({
  data: Schema.Struct({ routes: Schema.Array(S.Route) }),
});
const ColoursResponse = Schema.Struct({
  routes: Schema.Array(
    Schema.Struct({ code: Schema.String, color_hex: Schema.String }),
  ),
});
const StopsResponse = Schema.Struct({
  data: Schema.Struct({ stops: Schema.Array(S.Stop) }),
});
const JourneyResponse = Schema.Struct({ data: S.JourneyPlan });
const PlacesResponse = Schema.Struct({
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
const PlaceStopsResponse = Schema.Struct({
  stops: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      stop_code: Schema.String,
      eimsky_id: Schema.String,
    }),
  ),
});

export const LankaMetroReference = Layer.effect(
  ReferenceUpstream,
  Effect.gen(function* () {
    const { eimskyBase } = yield* LankaMetroConfig;
    const { lankametroBase, occasionsIcsUrl } = yield* ReferenceConfig;
    const http = yield* HttpClient.HttpClient;
    const fareApi = `${eimskyBase}/fare-service/api/v1`;

    const session = (
      token: Token,
    ): Effect.Effect<Redacted.Redacted<string>, UpstreamError> =>
      Option.match(token, {
        onNone: () =>
          Effect.fail(
            new UpstreamError({ message: "no upstream session", status: 502 }),
          ),
        onSome: Effect.succeed,
      });

    const withSession = <A>(
      value: Redacted.Redacted<string>,
      url: string,
      schema: Schema.Codec<A, unknown>,
    ) =>
      fetchJson(http, url, {
        headers: { authorization: `Bearer ${Redacted.value(value)}` },
        detail: eimskyDetail,
      }).pipe(Effect.flatMap(decodeWith(schema)));

    const authed = <A>(
      token: Token,
      url: string,
      schema: Schema.Codec<A, unknown>,
    ) =>
      session(token).pipe(
        Effect.flatMap((value) => withSession(value, url, schema)),
      );

    // Without lankametro.lk's colours the operator's own still serve, as production does once its stale colours expire.
    const colours = fetchJson(http, `${lankametroBase}/api/routes`).pipe(
      Effect.flatMap(decodeWith(ColoursResponse)),
      Effect.map(
        (body) =>
          new Map(body.routes.map((route) => [route.code, route.color_hex])),
      ),
      Effect.catch((error) =>
        Effect.logWarning("route colours unavailable", {
          message: error.message,
          status: error.status,
        }).pipe(Effect.as(new Map<string, string>())),
      ),
    );

    const occasions = Effect.gen(function* () {
      const events = parseIcs(yield* fetchText(http, occasionsIcsUrl));
      if (events.length === 0)
        return yield* new UpstreamError({ message: "holiday feed is empty" });
      const last = events.reduce(
        (latest, event) => (event.date > latest ? event.date : latest),
        "",
      );
      const today = colomboDay(yield* Clock.currentTimeMillis);
      if (last < addDays(today, FEED_ENDING_DAYS))
        yield* Effect.logWarning("holiday feed ends soon", { last });
      const years = events.map((event) => Number(event.date.slice(0, 4)));
      return toOccasions(events, Math.min(...years), Math.max(...years) + 1);
    });

    return ReferenceUpstream.of({
      needsLogin: true,
      routes: (token) =>
        session(token).pipe(
          Effect.flatMap((value) =>
            Effect.all(
              [
                withSession(value, `${fareApi}/routes/geo`, RoutesResponse),
                colours,
              ],
              { concurrency: 2 },
            ),
          ),
          Effect.map(([body, byCode]) =>
            colourRoutes(body.data.routes, byCode),
          ),
        ),
      stops: (token, route, direction) =>
        authed(
          token,
          `${fareApi}/routes/${encodeURIComponent(route.id)}/stops?${new URLSearchParams({ direction_id: direction.id })}`,
          StopsResponse,
        ).pipe(
          Effect.map((body) =>
            body.data.stops.map((stop) => ({
              ...stop,
              stop_name_en: stop.stop_name_en.trim(),
              stop_name_si: stop.stop_name_si.trim(),
              stop_name_tm: stop.stop_name_tm.trim(),
            })),
          ),
        ),
      geometry: (_token, _route, direction) => {
        const url = direction.geojson_url;
        if (!url.startsWith(GCS))
          return Effect.fail(
            new UpstreamError({ message: "unexpected geometry URL" }),
          );
        return fetchJson(http, url).pipe(
          Effect.catch(() =>
            fetchJson(
              http,
              `${lankametroBase}/gcs-proxy/${url.slice(GCS.length)}`,
            ),
          ),
        );
      },
      places: Effect.all(
        [
          fetchJson(http, `${lankametroBase}/api/places`).pipe(
            Effect.flatMap(decodeWith(PlacesResponse)),
          ),
          fetchJson(http, `${lankametroBase}/api/stops`).pipe(
            Effect.flatMap(decodeWith(PlaceStopsResponse)),
          ),
        ],
        { concurrency: 2 },
      ).pipe(
        Effect.map(([places, stops]) => linkPlaces(places.places, stops.stops)),
      ),
      occasions,
      journey: (token, from, to, date) =>
        authed(
          token,
          `${fareApi}/journeys/plan?${new URLSearchParams({ from_stop_id: from, to_stop_id: to, date })}`,
          JourneyResponse,
        ).pipe(
          Effect.map(({ data }) => ({
            ...data,
            // `option_token` is for booking, which this API does not offer.
            options: data.options.map(
              ({ option_token: _, ...option }) => option,
            ),
          })),
        ),
    });
  }),
);
