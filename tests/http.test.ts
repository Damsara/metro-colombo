import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer, type Socket } from "node:net";
import { test } from "node:test";
import { Cause, Effect, Exit } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import {
  CONNECT_TIMEOUT_MS,
  HEDGE_DELAY_MS,
  isConnectTimeout,
  MAX_CONCURRENT_REQUESTS,
  withFastConnect,
} from "../src/http.js";

const listen = async (server: ReturnType<typeof createHttpServer>) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
};

const run = <A>(
  use: (client: HttpClient.HttpClient) => Effect.Effect<A, unknown>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(withFastConnect(yield* HttpClient.HttpClient));
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );

test("a stalled connection is abandoned quickly and dialled once more, alongside its hedge", async () => {
  const sockets: Socket[] = [];
  const dialledAt: number[] = [];
  const started = performance.now();
  const server = createServer((socket) => {
    sockets.push(socket);
    dialledAt.push(performance.now() - started);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = withFastConnect(yield* HttpClient.HttpClient);
      return yield* client.get(`https://127.0.0.1:${port}/`);
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  const elapsed = performance.now() - started;
  sockets.forEach((socket) => socket.destroy());
  server.close();

  assert.ok(Exit.isFailure(exit));
  assert.ok(isConnectTimeout(Cause.squash(exit.cause)));
  assert.equal(sockets.length, 4);
  assert.ok(dialledAt[1]! < CONNECT_TIMEOUT_MS, `hedged at ${dialledAt[1]}ms`);
  const expected = HEDGE_DELAY_MS + CONNECT_TIMEOUT_MS * 2;
  assert.ok(elapsed >= expected - 100, `took ${elapsed}ms`);
  assert.ok(elapsed < expected + 1500, `took ${elapsed}ms`);
});

test("error responses are not retried", async () => {
  let requests = 0;
  const server = createHttpServer((_, res) => {
    requests += 1;
    res.writeHead(503).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  const status = await Effect.runPromise(
    Effect.gen(function* () {
      const client = withFastConnect(yield* HttpClient.HttpClient);
      const response = yield* client.get(`http://127.0.0.1:${port}/`);
      return response.status;
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  server.close();

  assert.equal(status, 503);
  assert.equal(requests, 1);
});

test("a GET whose first request hangs is answered by the hedge", async () => {
  let requests = 0;
  let hungAborted = false;
  const server = createHttpServer((req, res) => {
    requests += 1;
    if (requests === 1) {
      res.on("close", () => (hungAborted = true));
      return;
    }
    res.writeHead(200).end("ok");
  });
  const url = await listen(server);

  const started = performance.now();
  const status = await run((client) =>
    Effect.map(client.get(url), (response) => response.status),
  );
  const elapsed = performance.now() - started;
  await new Promise((resolve) => setTimeout(resolve, 100));
  server.closeAllConnections();
  server.close();

  assert.equal(status, 200);
  assert.equal(requests, 2);
  assert.ok(hungAborted);
  assert.ok(elapsed >= HEDGE_DELAY_MS - 50, `took ${elapsed}ms`);
  assert.ok(elapsed < HEDGE_DELAY_MS + 500, `took ${elapsed}ms`);
});

test("a fast GET is sent once", async () => {
  let requests = 0;
  const server = createHttpServer((_, res) => {
    requests += 1;
    res.writeHead(200).end("ok");
  });
  const url = await listen(server);

  await run((client) => client.get(url));
  await new Promise((resolve) => setTimeout(resolve, HEDGE_DELAY_MS * 2));
  server.closeAllConnections();
  server.close();

  assert.equal(requests, 1);
});

test("a slow POST is never hedged", async () => {
  let requests = 0;
  const server = createHttpServer((_, res) => {
    requests += 1;
    setTimeout(() => res.writeHead(200).end("ok"), HEDGE_DELAY_MS * 3);
  });
  const url = await listen(server);

  const status = await run((client) =>
    Effect.map(client.post(url), (response) => response.status),
  );
  server.closeAllConnections();
  server.close();

  assert.equal(status, 200);
  assert.equal(requests, 1);
});

test("concurrent requests are capped", async () => {
  let active = 0;
  let peak = 0;
  const server = createHttpServer((_, res) => {
    active += 1;
    peak = Math.max(peak, active);
    setTimeout(() => {
      active -= 1;
      res.writeHead(200).end("ok");
    }, HEDGE_DELAY_MS * 2);
  });
  const url = await listen(server);

  const statuses = await run((client) =>
    Effect.forEach(
      Array.from({ length: MAX_CONCURRENT_REQUESTS * 3 }),
      () => Effect.map(client.get(url), (response) => response.status),
      { concurrency: "unbounded" },
    ),
  );
  server.closeAllConnections();
  server.close();

  assert.ok(statuses.every((status) => status === 200));
  assert.equal(peak, MAX_CONCURRENT_REQUESTS);
});

test("a request waiting for a permit can be interrupted", async () => {
  let requests = 0;
  const server = createHttpServer(() => {
    requests += 1;
  });
  const url = await listen(server);

  const started = performance.now();
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = withFastConnect(yield* HttpClient.HttpClient);
      yield* Effect.forEach(
        Array.from({ length: MAX_CONCURRENT_REQUESTS }),
        () => Effect.forkChild(client.post(url)),
      );
      return yield* client.get(url).pipe(Effect.timeout(HEDGE_DELAY_MS));
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  const elapsed = performance.now() - started;
  server.closeAllConnections();
  server.close();

  assert.ok(Exit.isFailure(exit));
  assert.equal(requests, MAX_CONCURRENT_REQUESTS);
  assert.ok(elapsed < HEDGE_DELAY_MS + 200, `took ${elapsed}ms`);
});
