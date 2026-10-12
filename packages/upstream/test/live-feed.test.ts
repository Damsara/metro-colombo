import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Fiber, Layer, Option, Redacted } from "effect";
import { HttpClient } from "effect/http";
import { Socket } from "@metro/core";
import {
  fakeHttpClient,
  scriptedSocket,
  type FakeReply,
} from "@metro/core/testing";
import {
  gpsPayload,
  LankaMetroFeed,
  LiveFeed,
  type LiveFeedShape,
} from "@metro/upstream";

const routesReply: FakeReply = {
  status: 200,
  json: {
    data: {
      routes: [
        {
          id: "route-1",
          code: "138",
          name: "Pettah - Homagama",
          directions: [],
        },
      ],
    },
  },
};

const setup = (reply: FakeReply = routesReply) => {
  const socket = scriptedSocket();
  const http = fakeHttpClient(() => reply);
  const layer = LankaMetroFeed.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Socket, socket.socket),
        Layer.succeed(HttpClient.HttpClient, http.client),
      ),
    ),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({}))),
  );
  const run = <A, E>(use: (feed: LiveFeedShape) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* LiveFeed);
      }).pipe(Effect.provide(layer)),
    );
  return { socket, http, run };
};

const token = Option.some(Redacted.make("webview"));

test("gps frames yield their payload and anything else yields nothing", () => {
  assert.deepEqual(
    gpsPayload(
      JSON.stringify({ type: "gps_update", payload: [{ bus_id: "a" }] }),
    ),
    [{ bus_id: "a" }],
  );
  assert.deepEqual(
    gpsPayload(JSON.stringify({ type: "gps_update", payload: [] })),
    [],
  );
  assert.equal(gpsPayload(JSON.stringify({ type: "ping" })), undefined);
  assert.equal(
    gpsPayload(JSON.stringify({ type: "gps_update", payload: {} })),
    undefined,
  );
  assert.equal(gpsPayload("not json"), undefined);
});

test("a session opens the live socket with the token and origin, and hands over each frame", async () => {
  const { socket, run } = setup();
  const batches: unknown[][] = [];
  let messages = 0;
  const handlers = {
    onMessage: () => void (messages += 1),
    onBatch: (payload: ReadonlyArray<unknown>) =>
      void batches.push([...payload]),
  };
  await run((feed) =>
    Effect.gen(function* () {
      const fiber = yield* feed
        .run(token, handlers)
        .pipe(Effect.forkChild({ startImmediately: true }));
      const connection = socket.connections[0];
      connection.send(
        JSON.stringify({ type: "gps_update", payload: [{ bus_id: "a" }] }),
      );
      connection.send(JSON.stringify({ type: "ping" }));
      connection.send("not json");
      connection.close();
      yield* Fiber.join(fiber);
    }),
  );
  assert.equal(
    socket.connections[0].url,
    "wss://metrobusapiprod.eimsky.com/ticketing-service/ws?token=webview",
  );
  assert.deepEqual(socket.connections[0].headers, {
    origin: "https://lmtgo.eimsky.com",
  });
  assert.deepEqual(batches, [[{ bus_id: "a" }]]);
  assert.equal(messages, 3);
});

test("without a session the feed refuses to start", async () => {
  const { socket, run } = setup();
  const error = await run((feed) =>
    Effect.flip(
      feed.run(Option.none(), { onMessage: () => {}, onBatch: () => {} }),
    ),
  );
  assert.equal(error.message, "no upstream session");
  assert.equal(socket.connections.length, 0);
});

test("a refused socket is a FeedError", async () => {
  const { socket, run } = setup();
  socket.setRefuse(true);
  const error = await run((feed) =>
    Effect.flip(feed.run(token, { onMessage: () => {}, onBatch: () => {} })),
  );
  assert.equal(error._tag, "FeedError");
  assert.equal(error.message, "refused");
});

test("route codes come from the fare service with the session as bearer", async () => {
  const { http, run } = setup();
  assert.deepEqual(await run((feed) => feed.routes(token)), [
    { id: "route-1", code: "138" },
  ]);
  assert.equal(
    http.requests[0].url.toString(),
    "https://metrobusapiprod.eimsky.com/fare-service/api/v1/routes/geo",
  );
  assert.equal(http.requests[0].headers["authorization"], "Bearer webview");
});

test("a failed routes call is a FeedError", async () => {
  const { run } = setup({ status: 500, text: "boom" });
  const error = await run((feed) => Effect.flip(feed.routes(token)));
  assert.equal(error.message, "routes answered HTTP 500");
});

test("a 200 reply that is not JSON is a FeedError", async () => {
  const { run } = setup({ status: 200, text: "not json" });
  const error = await run((feed) => Effect.flip(feed.routes(token)));
  assert.equal(error._tag, "FeedError");
  assert.match(error.message, /^routes failed: /);
});

test("a 200 reply that fails the schema is a FeedError", async () => {
  const { run } = setup({
    status: 200,
    json: { data: { routes: [{ id: 1 }] } },
  });
  const error = await run((feed) => Effect.flip(feed.routes(token)));
  assert.equal(error._tag, "FeedError");
  assert.match(error.message, /^routes failed: /);
});

test("interrupting a session closes the socket", async () => {
  const { socket, run } = setup();
  await run((feed) =>
    Effect.gen(function* () {
      const fiber = yield* feed
        .run(token, { onMessage: () => {}, onBatch: () => {} })
        .pipe(Effect.forkChild({ startImmediately: true }));
      assert.equal(socket.connections[0].isOpen(), true);
      yield* Fiber.interrupt(fiber);
    }),
  );
  assert.equal(socket.connections[0].isOpen(), false);
});
