import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Exit, Fiber, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { type WebSocket, WebSocketServer } from "ws";
import { fakeHttpClient, settle, testClockAt } from "@metro/core/testing";
import { clockSuite } from "../../../packages/core/test/suites/clock.suite.ts";
import { objectStoreSuite } from "../../../packages/core/test/suites/object-store.suite.ts";
import { schedulerSuite } from "../../../packages/core/test/suites/scheduler.suite.ts";
import { type ServeSocket, socketSuite } from "../../../packages/core/test/suites/socket.suite.ts";
import { stateStoreSuite } from "../../../packages/core/test/suites/state-store.suite.ts";
import { fileObjectStore } from "../src/ports/file-object-store.ts";
import { fileStateStore } from "../src/ports/file-state-store.ts";
import { makeNodeTicker } from "../src/ports/node-ticker.ts";
import { s3ObjectStore } from "../src/ports/s3-object-store.ts";
import { wsSocket } from "../src/ports/ws-socket.ts";

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const fakeS3 = (bucket: string) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string; cacheControl?: string }>();
  return fakeHttpClient((request) => {
    assert.match(request.headers["authorization"] ?? "", /^AWS4-HMAC-SHA256 /);
    const path = decodeURIComponent(request.url.pathname).replace(new RegExp(`^/${bucket}/?`), "");
    if (request.method === "GET" && request.url.searchParams.get("list-type") === "2") {
      const prefix = request.url.searchParams.get("prefix") ?? "";
      const all = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = Number(request.url.searchParams.get("continuation-token") ?? 0);
      const truncated = start + 1 < all.length;
      const keys = all
        .slice(start, start + 1)
        .map((key) => `<Contents><Key>${escapeXml(key)}</Key></Contents>`)
        .join("");
      const next = truncated ? `<NextContinuationToken>${start + 1}</NextContinuationToken>` : "";
      return { status: 200, text: `<ListBucketResult>${keys}<IsTruncated>${truncated}</IsTruncated>${next}</ListBucketResult>` };
    }
    if (request.method === "PUT") {
      objects.set(path, {
        bytes: request.bytes,
        contentType: request.headers["content-type"] ?? "",
        ...(request.headers["cache-control"] ? { cacheControl: request.headers["cache-control"] } : {}),
      });
      return { status: 200 };
    }
    if (request.method === "GET") {
      const found = objects.get(path);
      return found
        ? {
            status: 200,
            bytes: found.bytes,
            headers: { "content-type": found.contentType, ...(found.cacheControl ? { "cache-control": found.cacheControl } : {}) },
          }
        : { status: 404, text: "<Error><Code>NoSuchKey</Code></Error>" };
    }
    if (request.method === "DELETE") {
      objects.delete(path);
      return { status: 204 };
    }
    return { status: 400, text: "unexpected request" };
  });
};

const serveWs: ServeSocket = async (options = {}) => {
  const server = createServer();
  const sockets = new WebSocketServer({ server, verifyClient: (_info, done) => done(!options.refuse, 401) });
  let headers: Record<string, string> = {};
  let peer: WebSocket | undefined;
  let resolveOpened!: () => void;
  let resolveClosed!: () => void;
  const opened = new Promise<void>((resolve) => (resolveOpened = resolve));
  const clientClosed = new Promise<void>((resolve) => (resolveClosed = resolve));
  sockets.on("connection", (socket, request) => {
    peer = socket;
    headers = Object.fromEntries(
      Object.entries(request.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    socket.on("close", () => resolveClosed());
    resolveOpened();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/ticketing-service/ws`,
    upgradeHeaders: () => headers,
    opened,
    clientClosed,
    send: (text) => peer?.send(text),
    sendBinary: (bytes) => peer?.send(bytes),
    close: () => peer?.close(1000, "bye"),
    stop: () =>
      new Promise<void>((resolve) => {
        sockets.close();
        server.close(() => resolve());
      }),
  };
};

const s3Settings = {
  endpoint: "https://s3.test",
  bucket: "metro-data-staging",
  accessKeyId: Redacted.make("AKIDSTAGINGKEY"),
  secretAccessKey: Redacted.make("staging-secret-value"),
};

objectStoreSuite(test, "file", (body) => body(fileObjectStore(temp("objects-"))));
objectStoreSuite(test, "s3", (body) => body(s3ObjectStore(s3Settings, fakeS3("metro-data-staging").client)));
stateStoreSuite(test, "file", (body) => {
  const path = join(temp("state-"), "fleet-state.json");
  return body(() => fileStateStore(path));
});
schedulerSuite(test, "node ticker", async (body) => body((await Effect.runPromise(makeNodeTicker)).scheduler));
socketSuite(test, "ws", wsSocket, serveWs);
clockSuite(test, "node");

test("the state file is readable only by its owner", async () => {
  const path = join(temp("state-"), "fleet-state.json");
  await Effect.runPromise(fileStateStore(path).set("session", { refreshToken: "r" }));
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("a state write leaves no temporary file behind", async () => {
  const dir = temp("state-");
  const store = fileStateStore(join(dir, "fleet-state.json"));
  await Effect.runPromise(Effect.all([store.set("a", 1), store.set("b", 2), store.delete("a")], { concurrency: "unbounded" }));
  assert.deepEqual(readdirSync(dir), ["fleet-state.json"]);
  const reopened = fileStateStore(join(dir, "fleet-state.json"));
  assert.equal((await Effect.runPromise(reopened.get("b")))._tag, "Some");
  assert.equal((await Effect.runPromise(reopened.get("a")))._tag, "None");
});

test("a state error names neither the key nor the value", async () => {
  const path = join(temp("state-"), "fleet-state.json");
  writeFileSync(path, '{"session":{"refreshToken":"secret-token"');
  const exit = await Effect.runPromise(Effect.exit(fileStateStore(path).set("session", { refreshToken: "new-token" })));
  assert.ok(Exit.isFailure(exit));
  const shown = String(exit.cause);
  assert.match(shown, /StateError/);
  for (const leak of ["session", "secret-token", "new-token", "refreshToken"]) assert.ok(!shown.includes(leak), `leaked ${leak}`);
});

test("a state write that hangs fails as a StateError within its time limit", async () => {
  const path = join(temp("state-"), "fleet-state.json");
  execFileSync("mkfifo", [path]);
  const started = Date.now();
  const exit = await Effect.runPromise(Effect.exit(fileStateStore(path, 100).set("session", { refreshToken: "r" })));
  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /StateError/);
  assert.ok(Date.now() - started < 2_000);
  closeSync(openSync(path, "w"));
});

test("a prepared file without metadata reads as octet-stream", async () => {
  const root = temp("objects-");
  mkdirSync(join(root, "replay", "2026-10-11"), { recursive: true });
  writeFileSync(join(root, "replay", "2026-10-11", "08.ndjson.gz"), Uint8Array.from([1, 2]));
  const found = await Effect.runPromise(fileObjectStore(root).get("replay/2026-10-11/08.ndjson.gz"));
  assert.equal(found._tag, "Some");
  if (found._tag === "Some") assert.equal(found.value.contentType, "application/octet-stream");
});

test("a key that climbs out of the folder is refused", async () => {
  const exit = await Effect.runPromise(
    Effect.exit(fileObjectStore(temp("objects-")).put("../escape.json", Uint8Array.from([1]), { contentType: "application/json" })),
  );
  assert.equal(exit._tag, "Failure");
});

test("an S3 failure names neither the credentials nor the signature", async () => {
  const s3 = fakeHttpClient(() => ({ status: 403, text: "<Error><Code>SignatureDoesNotMatch</Code></Error>" }));
  const exit = await Effect.runPromise(
    Effect.exit(s3ObjectStore(s3Settings, s3.client).put("live/live.json", Uint8Array.from([1]), { contentType: "application/json" })),
  );
  assert.ok(Exit.isFailure(exit));
  const shown = String(exit.cause);
  assert.match(shown, /HTTP 403/);
  const signature = /Signature=([0-9a-f]+)/.exec(s3.requests[0]?.headers["authorization"] ?? "")?.[1];
  assert.ok(signature);
  for (const leak of ["AKIDSTAGINGKEY", "staging-secret-value", signature]) assert.ok(!shown.includes(leak), `leaked ${leak}`);
});

test("a socket error never shows the URL or its token", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(302, { location: "ws://127.0.0.1:1/elsewhere" });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  for (const url of [`ws://127.0.0.1:${port}/ticketing-service/ws?token=secret-token`, "not a url ?token=secret-token"]) {
    const exit = await Effect.runPromise(Effect.exit(wsSocket.connect(url, {}, () => {})));
    assert.ok(Exit.isFailure(exit));
    const shown = String(exit.cause);
    assert.match(shown, /SocketError/);
    assert.ok(!shown.includes("secret-token") && !shown.includes("127.0.0.1"), shown);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("the node ticker runs a tick when its wake-up is due", async () => {
  let ticks = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const ticker = yield* makeNodeTicker;
      yield* ticker.scheduler.wakeAfter(1_000);
      const fiber = yield* ticker.drive(Effect.sync(() => void (ticks += 1))).pipe(Effect.forkChild);
      yield* settle;
      yield* TestClock.adjust(999);
      yield* settle;
      assert.equal(ticks, 0);
      yield* TestClock.adjust(1);
      yield* settle;
      assert.equal(ticks, 1);
      yield* TestClock.adjust(5_000);
      yield* settle;
      assert.equal(ticks, 2);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(testClockAt(Date.parse("2026-10-12T08:00:00+05:30")))),
  );
});

test("a sooner wake-up cuts short the node ticker's wait", async () => {
  let ticks = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const ticker = yield* makeNodeTicker;
      yield* ticker.scheduler.wakeAfter(60_000);
      const fiber = yield* ticker.drive(Effect.sync(() => void (ticks += 1))).pipe(Effect.forkChild);
      yield* settle;
      yield* ticker.scheduler.wakeAfter(1_000);
      yield* settle;
      yield* TestClock.adjust(1_000);
      yield* settle;
      assert.equal(ticks, 1);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(testClockAt(Date.parse("2026-10-12T08:00:00+05:30")))),
  );
});
