import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { Occasions } from "../src/occasions.js";

const client = (respond: () => Response) =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, respond())),
    ),
  );

const feed = [
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261108",
  "SUMMARY:Deepavali Festival Day",
  "END:VEVENT",
].join("\r\n");

const upcoming = (layer: Layer.Layer<HttpClient.HttpClient>, today: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Occasions).upcoming(today);
    }).pipe(Effect.provide(Occasions.layer.pipe(Layer.provide(layer)))),
  );

test("serves upcoming occasions from the feed", async () => {
  const result = await upcoming(
    client(() => new Response(feed, { status: 200 })),
    "2026-10-11",
  );
  assert.deepEqual(
    result.map((o) => `${o.date} ${o.kind}`),
    ["2026-11-08 deepavali", "2026-12-31 newYearsEve", "2027-01-01 newYear"],
  );
});

test("falls back to the bundled snapshot when the feed is down", async () => {
  const result = await upcoming(
    client(() => new Response("nope", { status: 503 })),
    "2026-10-11",
  );
  assert.ok(
    result.some((o) => o.date === "2026-11-08" && o.kind === "deepavali"),
  );
  assert.ok(result.every((o) => o.date >= "2026-10-11"));
});
