import assert from "node:assert/strict";
import { test } from "node:test";
import { Duration, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/http";
import { upcomingFrom } from "@metro/core";
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

test("a feed that hangs falls back instead of hanging the API", async () => {
  const hanging = Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make(() => Effect.never),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const occasions = yield* Occasions;
      const fiber = yield* Effect.forkChild(occasions.upcoming("2026-10-11"));
      yield* TestClock.adjust(Duration.seconds(20));
      return yield* Fiber.join(fiber);
    }).pipe(
      Effect.provide(Occasions.layer.pipe(Layer.provide(hanging))),
      Effect.provide(TestClock.layer()),
    ),
  );
  assert.ok(
    result.some((o) => o.date === "2026-11-08" && o.kind === "deepavali"),
  );
});

test("New Year's Day and Eve are known even after the feed runs out", () => {
  assert.deepEqual(
    upcomingFrom([], "2027-03-01").map((o) => `${o.date} ${o.kind}`),
    ["2027-12-31 newYearsEve", "2028-01-01 newYear"],
  );
});

test("an occasion in both the feed and the fixed days appears once", () => {
  const eve = { date: "2026-12-31", kind: "newYearsEve" as const, title: "x" };
  assert.equal(
    upcomingFrom([eve], "2026-12-01").filter((o) => o.date === "2026-12-31")
      .length,
    1,
  );
});
