import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Exit, Fiber, Option } from "effect";
import { HttpBody, HttpClientRequest } from "effect/http";
import {
  fakeHttpClient,
  memoryObjectStore,
  recordingAlerts,
  scriptedSocket,
  settle,
  spyObjectStore,
} from "@metro/core/testing";

const bytes = (text: string) => new TextEncoder().encode(text);

test("scriptedSocket: connect ends normally when the connection closes", async () => {
  const { socket, connections } = scriptedSocket();
  const received: string[] = [];
  const session = Effect.runPromise(socket.connect("wss://x", { a: "b" }, (text) => void received.push(text)));
  await Effect.runPromise(settle);
  const [connection] = connections;
  assert.ok(connection?.isOpen());
  assert.equal(connection.url, "wss://x");
  assert.deepEqual(connection.headers, { a: "b" });
  connection.send("hi");
  connection.close();
  connection.send("late");
  await session;
  assert.deepEqual(received, ["hi"]);
  assert.equal(connection.isOpen(), false);
});

test("scriptedSocket: a refused connect fails with SocketError", async () => {
  const { socket, connections, setRefuse } = scriptedSocket();
  setRefuse(true);
  const exit = await Effect.runPromise(Effect.exit(socket.connect("wss://x", {}, () => {})));
  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /SocketError/);
  assert.equal(connections.length, 0);
});

test("scriptedSocket: interrupting the session closes the connection", async () => {
  const { socket, connections } = scriptedSocket();
  const fiber = Effect.runFork(socket.connect("wss://x", {}, () => {}));
  await Effect.runPromise(settle);
  assert.equal(connections[0]?.isOpen(), true);
  await Effect.runPromise(Fiber.interrupt(fiber));
  assert.equal(connections[0]?.isOpen(), false);
});

test("fakeHttpClient: captures the request and replies with json", async () => {
  const { client, requests } = fakeHttpClient(() => ({ status: 200, json: { ok: true } }));
  const request = HttpClientRequest.post("https://example.test/a?b=1").pipe(
    HttpClientRequest.bodyText("hello", "text/plain"),
  );
  const response = await Effect.runPromise(client.execute(request));
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.url.href, "https://example.test/a?b=1");
  assert.equal(requests[0]?.text, "hello");
  assert.equal(response.headers["content-type"], "application/json");
  assert.deepEqual(await Effect.runPromise(response.json), { ok: true });
});

test("fakeHttpClient: text, bytes and 204 replies", async () => {
  const { client } = fakeHttpClient((request) => {
    switch (request.url.pathname) {
      case "/text":
        return { status: 200, text: "plain", headers: { "x-a": "1" } };
      case "/bytes":
        return { status: 200, bytes: Uint8Array.from([1, 2, 255]) };
      default:
        return { status: 204 };
    }
  });
  const get = (path: string) => Effect.runPromise(client.execute(HttpClientRequest.get(`https://example.test${path}`)));
  const text = await get("/text");
  assert.equal(await Effect.runPromise(text.text), "plain");
  assert.equal(text.headers["x-a"], "1");
  const binary = await get("/bytes");
  assert.deepEqual([...new Uint8Array(await Effect.runPromise(binary.arrayBuffer))], [1, 2, 255]);
  const empty = await get("/none");
  assert.equal(empty.status, 204);
  assert.equal(await Effect.runPromise(empty.text), "");
});

test("fakeHttpClient: a body it cannot record fails loudly", async () => {
  const { client, requests } = fakeHttpClient(() => ({ status: 200 }));
  const request = HttpClientRequest.post("https://example.test/").pipe(
    HttpClientRequest.setBody(HttpBody.formData(new FormData())),
  );
  const exit = await Effect.runPromise(Effect.exit(client.execute(request)));
  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /cannot record a FormData body/);
  assert.equal(requests.length, 0);
});

test("spyObjectStore: records gets and puts and injects put failures", async () => {
  const spy = spyObjectStore(memoryObjectStore());
  await Effect.runPromise(spy.store.put("a", bytes("1"), { contentType: "text/plain" }));
  await Effect.runPromise(spy.store.get("a"));
  assert.deepEqual(spy.gets, ["a"]);
  assert.equal(spy.puts.length, 1);
  assert.equal(spy.puts[0]?.key, "a");
  assert.equal(spy.puts[0]?.options.contentType, "text/plain");

  spy.setFailing(true);
  const exit = await Effect.runPromise(Effect.exit(spy.store.put("b", bytes("2"), { contentType: "text/plain" })));
  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /StoreError/);
  assert.equal(spy.puts.length, 1);
  assert.ok(Option.isNone(await Effect.runPromise(spy.store.get("b"))));

  spy.setFailing(false);
  await Effect.runPromise(spy.store.put("b", bytes("2"), { contentType: "text/plain" }));
  assert.equal(spy.puts.length, 2);
});

test("recordingAlerts: records what was sent", async () => {
  const { alerts, sent } = recordingAlerts();
  await Effect.runPromise(alerts.send({ title: "t", message: "m", urgent: true }));
  assert.deepEqual(sent, [{ title: "t", message: "m", urgent: true }]);
});

test("memoryObjectStore: a returned body is a copy", async () => {
  const store = memoryObjectStore();
  await Effect.runPromise(store.put("a", bytes("abc"), { contentType: "text/plain" }));
  const first = await Effect.runPromise(store.get("a"));
  assert.ok(Option.isSome(first));
  first.value.body[0] = 0;
  const second = await Effect.runPromise(store.get("a"));
  assert.ok(Option.isSome(second));
  assert.equal(new TextDecoder().decode(second.value.body), "abc");
});
