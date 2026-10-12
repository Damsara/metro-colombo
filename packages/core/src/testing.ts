import { Clock, Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import {
  type Alert,
  type AlertsShape,
  type ObjectStoreShape,
  type PutOptions,
  type SchedulerShape,
  SocketError,
  type SocketShape,
  type StateStoreShape,
  StoreError,
  type StoredObject,
} from "./ports.js";

export type Register = (name: string, body: () => Promise<void>) => void;

export const memoryObjectStore = (objects = new Map<string, StoredObject>()): ObjectStoreShape => ({
  get: (key) =>
    Effect.sync(() =>
      Option.map(Option.fromUndefinedOr(objects.get(key)), (stored): StoredObject => ({ ...stored, body: stored.body.slice() })),
    ),
  put: (key, body, { contentType, cacheControl }) =>
    Effect.sync(() => void objects.set(key, { body: body.slice(), contentType, cacheControl })),
  list: (prefix) => Effect.sync(() => [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()),
  delete: (key) => Effect.sync(() => void objects.delete(key)),
});

export const memoryStateStore = (backing = new Map<string, string>()): StateStoreShape => ({
  get: (key) => Effect.sync(() => Option.map(Option.fromUndefinedOr(backing.get(key)), (text): unknown => JSON.parse(text))),
  set: (key, value) => Effect.sync(() => void backing.set(key, JSON.stringify(value))),
  delete: (key) => Effect.sync(() => void backing.delete(key)),
});

export const memoryScheduler = (): SchedulerShape => {
  let next: number | undefined;
  return {
    wakeAfter: (ms) => Effect.map(Clock.currentTimeMillis, (now) => void (next = now + ms)),
    next: Effect.sync(() => Option.fromUndefinedOr(next)),
  };
};

export const spyObjectStore = (inner: ObjectStoreShape) => {
  const puts: { readonly key: string; readonly body: Uint8Array; readonly options: PutOptions }[] = [];
  const gets: string[] = [];
  let failing = false;
  const store: ObjectStoreShape = {
    ...inner,
    get: (key) => Effect.andThen(Effect.sync(() => void gets.push(key)), inner.get(key)),
    put: (key, body, options) =>
      failing
        ? Effect.fail(new StoreError({ message: `put of ${key} refused`, status: 503 }))
        : Effect.tap(inner.put(key, body, options), () => Effect.sync(() => void puts.push({ key, body, options }))),
  };
  return { store, puts, gets, setFailing: (value: boolean) => void (failing = value) };
};

export type ScriptedConnection = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly send: (text: string) => void;
  readonly close: () => void;
  readonly isOpen: () => boolean;
};

export const scriptedSocket = () => {
  const connections: ScriptedConnection[] = [];
  let refuse = false;
  const socket: SocketShape = {
    connect: (url, headers, onText) =>
      Effect.callback<void, SocketError>((resume) => {
        if (refuse) {
          resume(Effect.fail(new SocketError({ message: "refused" })));
          return;
        }
        let open = true;
        connections.push({
          url,
          headers,
          send: (text) => {
            if (open) onText(text);
          },
          close: () => {
            if (!open) return;
            open = false;
            resume(Effect.void);
          },
          isOpen: () => open,
        });
        return Effect.sync(() => void (open = false));
      }),
  };
  return { socket, connections, setRefuse: (value: boolean) => void (refuse = value) };
};

export const recordingAlerts = () => {
  const sent: Alert[] = [];
  const alerts: AlertsShape = { send: (alert) => Effect.sync(() => void sent.push(alert)) };
  return { alerts, sent };
};

export type FakeRequest = {
  readonly method: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
  readonly text: string;
};

export type FakeReply = {
  readonly status: number;
  readonly json?: unknown;
  readonly text?: string;
  readonly bytes?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
};

export const fakeHttpClient = (handle: (request: FakeRequest) => FakeReply) => {
  const requests: FakeRequest[] = [];
  const client = HttpClient.make((request, url) =>
    Effect.suspend(() => {
      if (request.body._tag !== "Empty" && request.body._tag !== "Uint8Array") {
        return Effect.die(new Error(`fakeHttpClient cannot record a ${request.body._tag} body`));
      }
      const bytes = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array();
      const seen: FakeRequest = {
        method: request.method,
        url,
        headers: { ...request.headers },
        bytes,
        text: new TextDecoder().decode(bytes),
      };
      requests.push(seen);
      const reply = handle(seen);
      const body =
        reply.status === 204
          ? null
          : reply.bytes
            ? new Uint8Array(reply.bytes)
            : reply.json !== undefined
              ? JSON.stringify(reply.json)
              : (reply.text ?? null);
      const headers = new Headers(reply.headers);
      if (reply.json !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status: reply.status, headers })));
    }),
  );
  return { client, requests };
};

export const testClockAt = (ms: number) =>
  Layer.effectDiscard(TestClock.setTime(ms)).pipe(Layer.provideMerge(TestClock.layer()));

export const settle = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
