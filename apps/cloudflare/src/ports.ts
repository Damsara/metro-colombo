import { Clock, Duration, Effect, Option } from "effect";
import {
  type ObjectStoreShape,
  type SchedulerShape,
  SocketError,
  type SocketShape,
  StateError,
  type StateStoreShape,
  StoreError,
  type StoredObject,
} from "@metro/core";

export const STATE_TIMEOUT_MS = 10_000;
export const STORE_TIMEOUT_MS = 20_000;

// Only the error's code or class name is kept, since a cause's message can quote stored contents.
const tagOf = (cause: unknown) => {
  const code = (cause as { readonly code?: unknown } | undefined)?.code;
  if (typeof code === "number" || typeof code === "string") return ` (${code})`;
  return cause instanceof Error ? ` (${cause.name})` : "";
};

export const r2ObjectStore = (bucket: R2Bucket, timeoutMs = STORE_TIMEOUT_MS): ObjectStoreShape => {
  const storeTry = <A>(what: string, run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (cause) => new StoreError({ message: `${what} failed${tagOf(cause)}` }) }).pipe(
      Effect.timeout(Duration.millis(timeoutMs)),
      Effect.catchTag("TimeoutError", () => Effect.fail(new StoreError({ message: `${what} timed out` }))),
    );
  return {
    get: (key) =>
      storeTry(`R2 read of ${key}`, async () => {
        const object = await bucket.get(key);
        if (!object) return Option.none<StoredObject>();
        return Option.some<StoredObject>({
          body: new Uint8Array(await object.arrayBuffer()),
          contentType: object.httpMetadata?.contentType,
          cacheControl: object.httpMetadata?.cacheControl,
        });
      }),
    put: (key, body, { contentType, cacheControl }) =>
      storeTry(`R2 upload of ${key}`, () =>
        bucket.put(key, body, { httpMetadata: { contentType, ...(cacheControl ? { cacheControl } : {}) } }),
      ).pipe(Effect.asVoid),
    list: (prefix) =>
      storeTry(`R2 list of ${prefix}`, async () => {
        const keys: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
          keys.push(...page.objects.map((object) => object.key));
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        return keys.sort();
      }),
    delete: (key) => storeTry(`R2 delete of ${key}`, () => bucket.delete(key)),
  };
};

export const doStateStore = (storage: DurableObjectStorage, timeoutMs = STATE_TIMEOUT_MS): StateStoreShape => {
  const limited = <A>(what: string, run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (cause) => new StateError({ message: `${what} failed${tagOf(cause)}` }) }).pipe(
      Effect.timeout(Duration.millis(timeoutMs)),
      Effect.catchTag("TimeoutError", () => Effect.fail(new StateError({ message: `${what} timed out` }))),
    );
  return {
    get: (key) => limited("state read", () => storage.get(key)).pipe(Effect.map(Option.fromUndefinedOr)),
    set: (key, value) => limited("state write", () => storage.put(key, value)),
    delete: (key) => limited("state delete", () => storage.delete(key)).pipe(Effect.asVoid),
  };
};

export const alarmScheduler = (storage: DurableObjectStorage): SchedulerShape => ({
  wakeAfter: (ms) => Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.promise(() => storage.setAlarm(now + ms))),
  next: Effect.promise(() => storage.getAlarm()).pipe(Effect.map(Option.fromNullishOr)),
});

// The URL carries the session token, so no message ever names it.
const didNotOpen = () => new SocketError({ message: "socket did not open" });

export type WorkerSocketOptions = { readonly handshakeTimeoutMs?: number; readonly maxMessageChars?: number };

// workerd has no setting for the largest incoming frame, so the cap is checked after a frame arrives.
export const makeWorkerSocket = ({
  handshakeTimeoutMs = 15_000,
  maxMessageChars = 2 * 1024 * 1024,
}: WorkerSocketOptions = {}): SocketShape => ({
  connect: (url, headers, onText) =>
    Effect.callback<void, SocketError>((resume) => {
      let done = false;
      let socket: WebSocket | undefined;
      const handshake = new AbortController();
      const finish = (effect: Effect.Effect<void, SocketError>) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resume(effect);
      };
      const timer = setTimeout(() => {
        handshake.abort();
        finish(Effect.fail(didNotOpen()));
      }, handshakeTimeoutMs);
      let upgrade: Promise<Response>;
      try {
        upgrade = fetch(url.replace(/^ws(s?):/, "http$1:"), {
          headers: { ...headers, Upgrade: "websocket" },
          redirect: "manual",
          signal: handshake.signal,
        });
      } catch {
        finish(Effect.fail(didNotOpen()));
        return;
      }
      upgrade.then(
        (response) => {
          const opened = response.webSocket;
          if (!opened) {
            finish(Effect.fail(didNotOpen()));
            return;
          }
          opened.accept();
          if (done) {
            opened.close(1000, "closing");
            return;
          }
          clearTimeout(timer);
          socket = opened;
          opened.addEventListener("message", (event) => {
            if (done || typeof event.data !== "string") return;
            if (event.data.length > maxMessageChars) {
              opened.close(1009, "message too big");
              finish(Effect.void);
              return;
            }
            onText(event.data);
          });
          opened.addEventListener("close", () => finish(Effect.void));
          opened.addEventListener("error", () => finish(Effect.void));
        },
        () => finish(Effect.fail(didNotOpen())),
      );
      return Effect.sync(() => {
        done = true;
        clearTimeout(timer);
        if (socket) socket.close(1000, "closing");
        else handshake.abort();
      });
    }),
});

export const workerSocket: SocketShape = makeWorkerSocket();
