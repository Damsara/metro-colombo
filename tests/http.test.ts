import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer, type Socket } from "node:net";
import { test } from "node:test";
import { Cause, Effect, Exit } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import {
  CONNECT_TIMEOUT_MS,
  isConnectTimeout,
  withFastConnect,
} from "../src/http.js";

test("a stalled connection is abandoned quickly and dialled once more", async () => {
  const sockets: Socket[] = [];
  const server = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  const started = performance.now();
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
  assert.equal(sockets.length, 2);
  assert.ok(elapsed >= CONNECT_TIMEOUT_MS * 2 - 100, `took ${elapsed}ms`);
  assert.ok(elapsed < CONNECT_TIMEOUT_MS * 2 + 1500, `took ${elapsed}ms`);
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
