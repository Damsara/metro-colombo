import assert from "node:assert/strict";
import { runInDurableObject } from "cloudflare:test";
import { Effect, Exit, Option } from "effect";
import { TestClock } from "effect/testing";
import { decodeArchiveChunk, encodeArchiveChunk, toArchiveRow } from "@metro/core";
import { memoryObjectStore, testClockAt } from "@metro/core/testing";
import { LIVE_ARCHIVE_KEY, makeRecorder } from "@metro/fleet";
import { test, vi } from "vitest";
import { clockSuite } from "../../../packages/core/test/suites/clock.suite.ts";
import { objectStoreSuite } from "../../../packages/core/test/suites/object-store.suite.ts";
import { schedulerSuite } from "../../../packages/core/test/suites/scheduler.suite.ts";
import { type ServeSocket, socketSuite } from "../../../packages/core/test/suites/socket.suite.ts";
import { stateStoreSuite } from "../../../packages/core/test/suites/state-store.suite.ts";
import { alertsSuite } from "../../../packages/fleet/test/suites/alerts.suite.ts";
import { alarmScheduler, doStateStore, makeWorkerSocket, r2ObjectStore, workerSocket } from "../src/ports.ts";
import { probe, testEnv } from "./env.ts";

const serveWorkerSocket: ServeSocket = async (options = {}) => {
  let headers: Record<string, string> = {};
  let peer: WebSocket | undefined;
  let resolveOpened!: () => void;
  let resolveClosed!: () => void;
  const opened = new Promise<void>((resolve) => (resolveOpened = resolve));
  const clientClosed = new Promise<void>((resolve) => (resolveClosed = resolve));
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    headers = Object.fromEntries(new Request(input, init).headers);
    if (options.refuse) return new Response("Jwt is missing", { status: 401 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.addEventListener("close", () => resolveClosed());
    peer = server;
    queueMicrotask(resolveOpened);
    return new Response(null, { status: 101, webSocket: client });
  });
  return {
    url: "wss://socket.test/ticketing-service/ws",
    upgradeHeaders: () => headers,
    opened,
    clientClosed,
    send: (text) => peer?.send(text),
    sendBinary: (bytes) => peer?.send(bytes),
    close: () => peer?.close(1000, "bye"),
    stop: async () => spy.mockRestore(),
  };
};

objectStoreSuite(test, "r2", (body) => body(r2ObjectStore(testEnv.ARCHIVE)));
stateStoreSuite(test, "durable object storage", (body) =>
  runInDurableObject(probe(), (_instance, state) => body(() => doStateStore(state.storage))),
);
schedulerSuite(test, "durable object alarms", (body) => runInDurableObject(probe(), (_instance, state) => body(alarmScheduler(state.storage))));
socketSuite(test, "workerd fetch upgrade", workerSocket, serveWorkerSocket);
clockSuite(test, "workerd");
alertsSuite(test, "ntfy on workerd");

const SECRET_URL = "wss://socket.test/ticketing-service/ws?token=secret-session-token";

const failureMessage = async <A, E>(effect: Effect.Effect<A, E>) => {
  const exit = await Effect.runPromise(Effect.exit(effect));
  assert.ok(Exit.isFailure(exit));
  return String(exit.cause);
};

test("a fetch that throws fails with one fixed reason that never names the url", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(`Network connection lost to ${SECRET_URL}`));
  try {
    const message = await failureMessage(workerSocket.connect(SECRET_URL, {}, () => {}));
    assert.match(message, /SocketError/);
    assert.doesNotMatch(message, /secret-session-token|socket\.test/);
  } finally {
    spy.mockRestore();
  }
});

test("a fetch that throws synchronously fails with the fixed reason and never names the url", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new TypeError(`Invalid URL ${SECRET_URL}`);
  });
  try {
    const message = await failureMessage(workerSocket.connect(SECRET_URL, {}, () => {}));
    assert.match(message, /SocketError: socket did not open/);
    assert.doesNotMatch(message, /secret-session-token|socket\.test/);
  } finally {
    spy.mockRestore();
  }
});

test("a refused upgrade never names the url and redirects are not followed", async () => {
  let init: RequestInit | undefined;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, given) => {
    init = given;
    return new Response(null, { status: 302, headers: { location: SECRET_URL } });
  });
  try {
    const message = await failureMessage(workerSocket.connect(SECRET_URL, {}, () => {}));
    assert.match(message, /SocketError/);
    assert.doesNotMatch(message, /secret-session-token|socket\.test/);
    assert.equal(init?.redirect, "manual");
  } finally {
    spy.mockRestore();
  }
});

test("a handshake that never answers times out and is aborted", async () => {
  let signal: AbortSignal | undefined;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((_input, given) => {
    signal = given?.signal ?? undefined;
    return new Promise<Response>(() => {});
  });
  try {
    const message = await failureMessage(makeWorkerSocket({ handshakeTimeoutMs: 50 }).connect(SECRET_URL, {}, () => {}));
    assert.match(message, /SocketError/);
    assert.doesNotMatch(message, /secret-session-token|socket\.test/);
    assert.equal(signal?.aborted, true);
  } finally {
    spy.mockRestore();
  }
});

test("a text frame over the size cap ends the session without delivering it", async () => {
  const server = await serveWorkerSocket();
  const received: string[] = [];
  const session = Effect.runPromise(
    makeWorkerSocket({ maxMessageChars: 1_000 }).connect(server.url, {}, (text) => void received.push(text)),
  );
  await server.opened;
  server.send("small");
  server.send("x".repeat(1_001));
  server.send("after");
  await session;
  await server.clientClosed;
  assert.deepEqual(received, ["small"]);
  await server.stop();
});

const hungStorage = { get: () => new Promise(() => {}), put: () => new Promise(() => {}), delete: () => new Promise(() => {}) };

test("a durable object storage call that hangs fails as StateError within its limit", async () => {
  const store = doStateStore(hungStorage as unknown as DurableObjectStorage, 50);
  for (const effect of [store.get("session"), store.set("session", { refreshToken: "r" }), store.delete("session")]) {
    const message = await failureMessage(effect);
    assert.match(message, /StateError/);
    assert.doesNotMatch(message, /session/);
  }
});

test("a durable object storage failure names no key and no stored value", async () => {
  const leaky = () => Promise.reject(new SyntaxError('Unexpected token in JSON at "session": {"refreshToken":"stored-secret"}'));
  const store = doStateStore({ get: leaky, put: leaky, delete: leaky } as unknown as DurableObjectStorage);
  for (const effect of [store.get("session"), store.set("session", { refreshToken: "value-secret" }), store.delete("session")]) {
    const message = await failureMessage(effect);
    assert.match(message, /StateError/);
    assert.doesNotMatch(message, /session|secret|refreshToken/);
  }
});

test("an R2 failure carries no detail from its cause", async () => {
  const leaky = () => Promise.reject(new Error("R2 failure with credential-secret"));
  const store = r2ObjectStore({ get: leaky, put: leaky, list: leaky, delete: leaky } as unknown as R2Bucket);
  for (const effect of [
    store.get("live/live.json"),
    store.put("live/live.json", new Uint8Array(), { contentType: "application/json" }),
    store.list("raw/"),
    store.delete("live/live.json"),
  ]) {
    const message = await failureMessage(effect);
    assert.match(message, /StoreError/);
    assert.doesNotMatch(message, /credential-secret/);
  }
});

test("an R2 call that hangs fails as StoreError within its limit", async () => {
  const hung = () => new Promise(() => {});
  const store = r2ObjectStore({ get: hung, put: hung, list: hung, delete: hung } as unknown as R2Bucket, 50);
  for (const effect of [
    store.get("live/live.json"),
    store.put("live/live.json", new Uint8Array(), { contentType: "application/json" }),
    store.list("raw/"),
    store.delete("live/live.json"),
  ]) {
    assert.match(await failureMessage(effect), /StoreError: R2 \w+ of [\w/.]+ timed out/);
  }
});

const rowA = toArchiveRow({ id: "bus-a", lat: 6.9, lng: 79.86, receivedAt: 1_791_685_800_100, route_id: "route-1", timestamp: 1_791_685_800_000 });
const rowB = toArchiveRow({ id: "bus-b", lat: 6.8, lng: 79.9, receivedAt: 1_791_685_802_100, current_capacity: 5, total_capacity: 60 });

test("workerd rejects two concatenated gzip members", async () => {
  const first = await encodeArchiveChunk([rowA]);
  const second = await encodeArchiveChunk([rowB]);
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  await assert.rejects(decodeArchiveChunk(joined), /Trailing bytes after end of compressed data/);
});

test("the recorder's live file decodes inside workerd to every row of the last hour", async () => {
  const start = Date.parse("2026-10-12T08:00:00+05:30");
  const fix = (id: string, at: number) => ({ id, lat: 6.9, lng: 79.86, receivedAt: at, timestamp: at });
  const store = memoryObjectStore();
  await Effect.runPromise(
    Effect.gen(function* () {
      const recorder = yield* makeRecorder({ store, instance: "fleet" });
      recorder.record(fix("a", start));
      yield* recorder.flush;
      yield* TestClock.adjust(5 * 60_000);
      recorder.record(fix("b", start + 5 * 60_000));
      yield* recorder.flush;
    }).pipe(Effect.provide(testClockAt(start))),
  );
  const live = Option.getOrThrow(await Effect.runPromise(store.get(LIVE_ARCHIVE_KEY)));
  assert.deepEqual((await decodeArchiveChunk(live.body)).map((row) => row.bus_id), ["a", "b"]);
});
