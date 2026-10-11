import assert from "node:assert/strict";
import { test } from "node:test";
import { Duration, Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { Auth } from "../src/auth.js";
import { UpstreamApi } from "../src/upstream.js";

test("a failed colour lookup is retried instead of sticking to the routes", async () => {
  const calls = { routes: 0, colours: 0 };
  const http = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const reply = (status: number, body: unknown) =>
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), { status }),
        );
      if (url.pathname.endsWith("/routes/geo")) {
        calls.routes += 1;
        return reply(200, {
          data: {
            routes: [
              {
                code: "CM01",
                id: "r1",
                name: "CM01",
                status: "active",
                is_favorite: false,
                directions: [],
              },
            ],
          },
        });
      }
      calls.colours += 1;
      return calls.colours === 1
        ? reply(503, {})
        : reply(200, { routes: [{ code: "CM01", color_hex: "#1A5A96" }] });
    }),
  );

  const program = Effect.gen(function* () {
    const api = yield* UpstreamApi;
    const first = yield* api.routes;
    assert.equal(first[0].color_hex, undefined);

    yield* TestClock.adjust(Duration.seconds(3));
    const second = yield* api.routes;
    assert.equal(second[0].color_hex, "#1A5A96");
    assert.equal(calls.routes, 1);
  });

  await Effect.runPromise(
    program.pipe(
      Effect.provide(
        UpstreamApi.layer.pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
          Layer.provide(
            Layer.succeed(
              Auth,
              Auth.of({ currentToken: Effect.succeed(Redacted.make("t")) }),
            ),
          ),
        ),
      ),
      Effect.provide(TestClock.layer()),
    ),
  );
});
