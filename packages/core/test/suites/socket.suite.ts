import assert from "node:assert/strict";
import { Effect, Exit, Fiber } from "effect";
import type { SocketShape } from "@metro/core";
import type { Register } from "@metro/core/testing";

export type SocketServer = {
  readonly url: string;
  readonly upgradeHeaders: () => Readonly<Record<string, string>>;
  readonly opened: Promise<void>;
  readonly clientClosed: Promise<void>;
  readonly send: (text: string) => void;
  readonly sendBinary: (bytes: Uint8Array) => void;
  readonly close: () => void;
  readonly stop: () => Promise<void>;
};
export type ServeSocket = (options?: {
  readonly refuse?: boolean;
}) => Promise<SocketServer>;

const within = <A>(promise: Promise<A>, what: string, ms = 5_000) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} took over ${ms} ms`)), ms),
    ),
  ]);

const waitFor = async (ready: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !ready(); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(ready(), "timed out waiting");
};

export function socketSuite(
  test: Register,
  name: string,
  socket: SocketShape,
  serve: ServeSocket,
) {
  test(`${name}: text frames arrive in order, binary frames are skipped, and a server close ends the session`, async () => {
    const server = await serve();
    const received: string[] = [];
    const session = Effect.runPromise(
      socket.connect(
        server.url,
        { origin: "https://lmtgo.eimsky.com" },
        (text) => void received.push(text),
      ),
    );
    await within(server.opened, "the upgrade");
    server.send("one");
    server.sendBinary(Uint8Array.from([1, 2, 3]));
    server.send("two");
    await waitFor(() => received.length === 2);
    server.close();
    await within(session, "the session's end");
    assert.deepEqual(received, ["one", "two"]);
    assert.equal(server.upgradeHeaders()["origin"], "https://lmtgo.eimsky.com");
    await server.stop();
  });

  test(`${name}: a refused upgrade fails with SocketError`, async () => {
    const server = await serve({ refuse: true });
    const exit = await within(
      Effect.runPromise(Effect.exit(socket.connect(server.url, {}, () => {}))),
      "the refusal",
    );
    assert.ok(Exit.isFailure(exit));
    assert.match(String(exit.cause), /SocketError/);
    await server.stop();
  });

  test(`${name}: interrupting the session closes the socket`, async () => {
    const server = await serve();
    const fiber = Effect.runFork(socket.connect(server.url, {}, () => {}));
    await within(server.opened, "the upgrade");
    await within(Effect.runPromise(Fiber.interrupt(fiber)), "the interrupt");
    await within(server.clientClosed, "the close");
    await server.stop();
  });
}
