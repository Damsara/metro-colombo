import assert from "node:assert/strict";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import {
  Alerts,
  decodeArchiveChunk,
  ObjectStore,
  type ObjectStoreShape,
  Scheduler,
  type SchedulerShape,
  Socket,
  StateStore,
  type StateStoreShape,
  StoreError,
} from "@metro/core";
import { recordingAlerts, type Register, scriptedSocket, settle, spyObjectStore, testClockAt } from "@metro/core/testing";
import { AuthClient, LankaMetroFeed } from "@metro/upstream";
import { Fleet, type FleetShape, LIVE_ARCHIVE_KEY, LIVE_CACHE, LIVE_JSON_KEY, VEHICLES_PB_KEY } from "@metro/fleet";
import { fakeLankaMetro } from "../support/fake-lanka-metro.ts";
import { capturedLogs } from "./alerts.suite.ts";

export type FleetWiring = {
  readonly objects: ObjectStoreShape;
  readonly openState: () => StateStoreShape;
  readonly scheduler: SchedulerShape;
};
export type WithFleetWiring = (body: (wiring: FleetWiring) => Promise<void>) => Promise<void>;

const T0 = Date.parse("2026-10-12T08:00:00+05:30");
const SECOND = 1_000;
const MINUTE = 60_000;
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const gps = (buses: ReadonlyArray<Record<string, unknown>>) => JSON.stringify({ type: "gps_update", payload: buses });
const bus = (id: string, lat = 6.9, timestamp = T0) => ({ bus_id: id, lat, lng: 79.86, route_id: "route-1", timestamp });
const validSession = { refreshToken: "stored", webviewToken: "webview-stored", expiresAt: T0 + 30 * MINUTE, refreshedAt: T0 - 30 * MINUTE };
const decodeJson = (body: Uint8Array) => JSON.parse(new TextDecoder().decode(body));

const protobufFields = (bytes: Uint8Array) => {
  const fields: { readonly field: number; readonly value: number | Uint8Array }[] = [];
  let at = 0;
  const varint = () => {
    let value = 0;
    let scale = 1;
    let byte: number;
    do {
      byte = bytes[at++];
      value += (byte & 0x7f) * scale;
      scale *= 128;
    } while (byte & 0x80);
    return value;
  };
  while (at < bytes.length) {
    const tag = varint();
    const wire = tag % 8;
    const field = Math.floor(tag / 8);
    if (wire === 0) fields.push({ field, value: varint() });
    else if (wire === 2 || wire === 5) {
      const length = wire === 2 ? varint() : 4;
      fields.push({ field, value: bytes.subarray(at, at + length) });
      at += length;
    } else throw new Error(`unexpected wire type ${wire}`);
  }
  assert.equal(at, bytes.length);
  return fields;
};
const nested = (fields: ReturnType<typeof protobufFields>, field: number) =>
  fields.filter((entry) => entry.field === field).map((entry) => protobufFields(entry.value as Uint8Array));
const scalar = (fields: ReturnType<typeof protobufFields>, field: number) => fields.find((entry) => entry.field === field)?.value;
const decodeVehicles = (body: Uint8Array) => {
  const feed = protobufFields(body);
  const [header] = nested(feed, 1);
  return {
    version: new TextDecoder().decode(scalar(header, 1) as Uint8Array),
    timestamp: scalar(header, 3),
    ids: nested(feed, 2).map((entity) => new TextDecoder().decode(scalar(entity, 1) as Uint8Array)),
  };
};

const harness = (wiring: FleetWiring, env: Record<string, string> = {}) => {
  const upstream = fakeLankaMetro();
  const socket = scriptedSocket();
  const alerts = recordingAlerts();
  const objects = spyObjectStore(wiring.objects);
  const logs = capturedLogs();
  const fleetAt = (at: number) =>
    Fleet.layer.pipe(
      Layer.provide(Layer.mergeAll(LankaMetroFeed, AuthClient.layer)),
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Socket, socket.socket),
          Layer.succeed(HttpClient.HttpClient, upstream.client),
          Layer.succeed(ObjectStore, objects.store),
          Layer.succeed(StateStore, wiring.openState()),
          Layer.succeed(Scheduler, wiring.scheduler),
          Layer.succeed(Alerts, alerts.alerts),
        ),
      ),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({ METRO_PHONE: "0771234567", ...env }))),
      Layer.provideMerge(testClockAt(at)),
      Layer.provideMerge(logs.layer),
    );
  const runFleet = <A>(at: number, use: (fleet: FleetShape) => Effect.Effect<A>) =>
    run(Effect.gen(function* () { return yield* use(yield* Fleet); }).pipe(Effect.provide(fleetAt(at))));
  const seed = (key: string, value: unknown) => run(wiring.openState().set(key, value));
  const putsTo = (key: string) => objects.puts.filter((put) => put.key === key);
  return { upstream, socket, alerts, objects, logs, runFleet, seed, putsTo };
};

export function fleetSuite(test: Register, name: string, withWiring: WithFleetWiring) {
  test(`${name}: a restart reuses a stored session without refreshing`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) => fleet.tick);
      assert.deepEqual(h.upstream.calls.refresh, []);
      assert.equal(h.socket.connections.length, 1);
      assert.equal(h.socket.connections[0].url, "wss://metrobusapiprod.eimsky.com/ticketing-service/ws?token=webview-stored");
      assert.equal(h.socket.connections[0].headers.origin, "https://lmtgo.eimsky.com");
    }));

  test(`${name}: a session about to expire is refreshed once and the new tokens are stored`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", { ...validSession, expiresAt: T0 + MINUTE });
      await h.runFleet(T0, (fleet) => Effect.andThen(fleet.tick, fleet.tick));
      assert.deepEqual(h.upstream.calls.refresh, ["stored"]);
      assert.deepEqual(Option.getOrUndefined(await run(wiring.openState().get("session"))), {
        refreshToken: "refresh-1",
        webviewToken: "webview-1",
        expiresAt: T0 + 3_600_000,
        refreshedAt: T0,
      });
      assert.equal(h.socket.connections[0].url.endsWith("token=webview-1"), true);
    }));

  test(`${name}: a configured seed is used only when storage is empty`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring, { METRO_REFRESH_TOKEN: "seed" });
      await h.runFleet(T0, (fleet) => fleet.tick);
      assert.deepEqual(h.upstream.calls.refresh, ["seed"]);
    }));

  test(`${name}: a dead stored token never falls back to the configured seed`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring, { METRO_REFRESH_TOKEN: "seed" });
      h.upstream.settings.refreshStatus = 400;
      await h.seed("session", { ...validSession, refreshToken: "dead", expiresAt: T0 - MINUTE });
      await h.runFleet(T0, (fleet) => Effect.andThen(fleet.tick, fleet.tick));
      await h.runFleet(T0 + MINUTE, (fleet) => fleet.tick);
      assert.deepEqual(h.upstream.calls.refresh, ["dead"]);
    }));

  test(`${name}: a dead token stops refreshing and keeps the last snapshot stale, and an SMS code resumes the feed`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      h.upstream.settings.refreshStatus = 400;
      await h.seed("session", { ...validSession, refreshToken: "dead", expiresAt: T0 - MINUTE });
      const last = { success: true, count: 1, timestamp: T0 - MINUTE, buses: [{ id: "bus-x", lat: 6.9, lng: 79.86 }] };
      await run(wiring.objects.put(LIVE_JSON_KEY, new TextEncoder().encode(JSON.stringify(last)), { contentType: "application/json" }));

      const down = await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.start;
          yield* fleet.tick;
          yield* fleet.tick;
          yield* TestClock.adjust(5 * MINUTE);
          yield* fleet.tick;
          yield* TestClock.adjust(6 * MINUTE);
          yield* fleet.tick;
          return yield* fleet.status;
        }),
      );

      assert.equal(down.login, "login_needed");
      assert.deepEqual(h.upstream.calls.refresh, ["dead"]);
      assert.deepEqual(h.upstream.calls.checkPhone, ["+94771234567", "+94771234567"]);
      assert.equal(h.socket.connections.length, 0);
      assert.deepEqual(h.alerts.sent.map((alert) => alert.title), ["Live buses are down: login needed"]);
      const published = h.putsTo(LIVE_JSON_KEY).at(-1);
      assert.ok(published);
      const doc = decodeJson(published.body);
      assert.equal(doc.stale, true);
      assert.equal(doc.reason, "login_needed");
      assert.deepEqual(doc.buses.map((entry: { id: string }) => entry.id), ["bus-x"]);

      const resumed = await h.runFleet(T0 + 12 * MINUTE, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          const wrong = yield* fleet.submitCode("999999");
          const right = yield* fleet.submitCode("123456");
          yield* fleet.tick;
          return { wrong, right, status: yield* fleet.status };
        }),
      );

      assert.equal(resumed.wrong._tag, "CodeRejected");
      assert.equal(resumed.right._tag, "Accepted");
      assert.equal(resumed.status.login, "ok");
      assert.equal(h.upstream.calls.checkPhone.length, 2);
      assert.match(h.socket.connections.at(-1)?.url ?? "", /token=webview-\d+$/);
      const stored = Option.getOrUndefined(await run(wiring.openState().get("session"))) as { refreshToken: string };
      assert.equal(stored.refreshToken, "refresh-otp");
      assert.deepEqual(h.alerts.sent.map((alert) => alert.title), ["Live buses are down: login needed", "Live buses: login restored"]);
      assert.equal(h.logs.lines.some((line) => /access-|refresh-otp|webview-\d/.test(line)), false);
    }));

  test(`${name}: the live socket reconnects with backoff that stops growing at 60 s`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      const delays = await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          const observed: number[] = [];
          for (let attempt = 1; attempt <= 7; attempt++) {
            h.socket.connections.at(-1)?.close();
            yield* settle;
            const before = h.socket.connections.length;
            let waited = 0;
            while (h.socket.connections.length === before && waited < 120 * SECOND) {
              yield* TestClock.adjust(SECOND);
              waited += SECOND;
              yield* fleet.tick;
            }
            observed.push(waited);
          }
          return observed;
        }),
      );
      assert.deepEqual(delays, [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
    }));

  test(`${name}: a socket that delivered positions reconnects after 1 s, and a silent one is closed after 30 s`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.socket.connections[0].send(gps([bus("bus-a")]));
          h.socket.connections[0].close();
          yield* settle;
          yield* TestClock.adjust(999);
          yield* fleet.tick;
          assert.equal(h.socket.connections.length, 1);
          yield* TestClock.adjust(1);
          yield* fleet.tick;
          assert.equal(h.socket.connections.length, 2);
          yield* TestClock.adjust(31 * SECOND);
          yield* fleet.tick;
          assert.equal(h.socket.connections[1].isOpen(), false);
        }),
      );
    }));

  test(`${name}: live.json and vehicles.pb are written when the snapshot changes`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.socket.connections[0].send(gps([bus("bus-a"), bus("bus-b", 6.8)]));
          yield* fleet.tick;
          yield* TestClock.adjust(5 * SECOND);
          yield* fleet.tick;
        }),
      );
      const writes = h.putsTo(LIVE_JSON_KEY);
      assert.equal(writes.length, 2);
      const doc = decodeJson(writes[1].body);
      assert.equal(doc.success, true);
      assert.equal(doc.stale, false);
      assert.equal(doc.count, 2);
      assert.equal(doc.age_ms, 0);
      assert.deepEqual(
        doc.buses.map((entry: { id: string; route_code: string }) => [entry.id, entry.route_code]),
        [["bus-a", "138"], ["bus-b", "138"]],
      );
      assert.equal(writes[1].options.cacheControl, "public, max-age=5");
      const pb = h.putsTo(VEHICLES_PB_KEY);
      assert.equal(pb.length, 2);
      assert.equal(pb[1].options.contentType, "application/x-protobuf");
      assert.ok(pb[1].body.length > 0);
    }));

  test(`${name}: both live files carry their content type and cache header, and vehicles.pb decodes`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.socket.connections[0].send(gps([bus("bus-a"), bus("bus-b", 6.8)]));
          yield* fleet.tick;
        }),
      );
      const json = h.putsTo(LIVE_JSON_KEY).at(-1);
      const pb = h.putsTo(VEHICLES_PB_KEY).at(-1);
      assert.ok(json && pb);
      assert.deepEqual(json.options, { contentType: "application/json", cacheControl: LIVE_CACHE });
      assert.deepEqual(pb.options, { contentType: "application/x-protobuf", cacheControl: LIVE_CACHE });
      assert.deepEqual(decodeVehicles(pb.body), { version: "2.0", timestamp: Math.floor(T0 / 1000), ids: ["bus-a", "bus-b"] });
    }));

  test(`${name}: empty frames don't rewrite the live files until a minute has passed`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.socket.connections[0].send(gps([]));
          yield* fleet.tick;
          for (let elapsed = 5 * SECOND; elapsed < MINUTE; elapsed += 5 * SECOND) {
            yield* TestClock.adjust(5 * SECOND);
            h.socket.connections[0].send(gps([]));
            yield* fleet.tick;
          }
        }),
      );
      const writes = h.putsTo(LIVE_JSON_KEY);
      assert.equal(writes.length, 2);
      const doc = decodeJson(writes[1].body);
      assert.equal(doc.stale, false);
      assert.equal(doc.count, 0);
    }));

  test(`${name}: empty frames all night keep the feed fresh rather than down`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      const night = Date.parse("2026-10-12T02:00:00+05:30");
      await h.seed("session", { ...validSession, expiresAt: night + 30 * MINUTE });
      const status = await h.runFleet(night, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          for (let elapsed = 0; elapsed < 5 * MINUTE; elapsed += 5 * SECOND) {
            h.socket.connections.at(-1)?.send(gps([]));
            yield* fleet.tick;
            yield* TestClock.adjust(5 * SECOND);
          }
          return yield* fleet.status;
        }),
      );
      assert.equal(status.feed, "connected");
      assert.equal(h.socket.connections.length, 1);
      const docs = h.putsTo(LIVE_JSON_KEY).map((put) => decodeJson(put.body));
      assert.deepEqual(docs.slice(1).map((doc) => doc.stale), docs.slice(1).map(() => false));
    }));

  test(`${name}: an unchanged stale snapshot is rewritten once a minute`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          for (let elapsed = 0; elapsed <= 2 * MINUTE; elapsed += 5 * SECOND) {
            yield* fleet.tick;
            yield* TestClock.adjust(5 * SECOND);
          }
        }),
      );
      assert.equal(h.putsTo(LIVE_JSON_KEY).length, 3);
    }));

  test(`${name}: going stale writes once, with the reason and the last fresh buses`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.socket.connections[0].send(gps([bus("bus-a")]));
          for (let elapsed = 0; elapsed <= 3 * MINUTE; elapsed += 5 * SECOND) {
            yield* fleet.tick;
            yield* TestClock.adjust(5 * SECOND);
            h.socket.connections.at(-1)?.send(JSON.stringify({ type: "ping" }));
          }
        }),
      );
      const docs = h.putsTo(LIVE_JSON_KEY).map((put) => decodeJson(put.body));
      assert.deepEqual(
        docs.map((doc) => [doc.stale, doc.reason ?? null, doc.buses.map((entry: { id: string }) => entry.id)]),
        [
          [true, "feed_down", []],
          [false, null, ["bus-a"]],
          [false, null, ["bus-a"]],
          [false, null, []],
          [true, "feed_down", ["bus-a"]],
        ],
      );
      assert.equal(docs[4].timestamp, T0);
    }));

  test(`${name}: a missing, corrupt or unreadable previous live.json starts with an empty stale snapshot`, () =>
    withWiring(async (wiring) => {
      const cases: ReadonlyArray<[string, FleetWiring]> = [
        ["missing", wiring],
        ["corrupt", wiring],
        ["unreadable", { ...wiring, objects: { ...wiring.objects, get: () => Effect.fail(new StoreError({ message: "get refused" })) } }],
      ];
      for (const [label, variant] of cases) {
        if (label === "corrupt") {
          await run(wiring.objects.put(LIVE_JSON_KEY, new TextEncoder().encode("{not json"), { contentType: "application/json" }));
        }
        const h = harness(variant);
        await h.seed("session", validSession);
        const next = await h.runFleet(T0, (fleet) => Effect.andThen(fleet.start, Effect.andThen(fleet.tick, wiring.scheduler.next)));
        assert.equal(Option.isSome(next), true, label);
        const published = h.putsTo(LIVE_JSON_KEY).at(-1);
        assert.ok(published, label);
        const doc = decodeJson(published.body);
        assert.deepEqual([doc.stale, doc.reason, doc.buses], [true, "feed_down", []], label);
      }
    }));

  test(`${name}: a failed live write is swallowed and retried on the next tick`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.objects.setFailing(true);
          h.socket.connections[0].send(gps([bus("bus-a")]));
          yield* fleet.tick;
          assert.equal(h.putsTo(LIVE_JSON_KEY).length, 1);
          assert.deepEqual(yield* wiring.scheduler.next, Option.some(T0 + 5 * SECOND));
          h.objects.setFailing(false);
          yield* TestClock.adjust(5 * SECOND);
          yield* fleet.tick;
          yield* TestClock.adjust(5 * SECOND);
          yield* fleet.tick;
        }),
      );
      const writes = h.putsTo(LIVE_JSON_KEY);
      assert.equal(writes.length, 2);
      assert.deepEqual(decodeJson(writes[1].body).buses.map((entry: { id: string }) => entry.id), ["bus-a"]);
      assert.equal(h.putsTo(VEHICLES_PB_KEY).length, 2);
    }));

  test(`${name}: positions are archived every 5 minutes and today's live file is rebuilt`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.socket.connections[0].send(gps([bus("bus-a")]));
          yield* TestClock.adjust(5 * MINUTE);
          h.socket.connections[0].send(gps([bus("bus-a", 6.91, T0 + 5 * MINUTE)]));
          yield* fleet.tick;
        }),
      );
      const chunk = h.putsTo("raw/2026-10-12/080500-fleet.ndjson.gz");
      assert.equal(chunk.length, 1);
      assert.equal(chunk[0].options.cacheControl, "public, max-age=31536000, immutable");
      const rows = await decodeArchiveChunk(chunk[0].body);
      assert.deepEqual(rows.map((row) => [row.bus_id, row.lat, row.received_at]), [
        ["bus-a", 6.9, T0],
        ["bus-a", 6.91, T0 + 5 * MINUTE],
      ]);
      const live = h.putsTo(LIVE_ARCHIVE_KEY);
      assert.equal(live.length, 1);
      assert.deepEqual([...live[0].body], [...chunk[0].body]);
      assert.equal(live[0].options.cacheControl, "public, max-age=60");
    }));

  test(`${name}: shutting down flushes buffered positions`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.socket.connections[0].send(gps([bus("bus-a")]));
        }),
      );
      const chunk = h.putsTo("raw/2026-10-12/080000-fleet.ndjson.gz");
      assert.equal(chunk.length, 1);
      assert.deepEqual((await decodeArchiveChunk(chunk[0].body)).map((row) => row.bus_id), ["bus-a"]);
    }));

  test(`${name}: shutting down twice flushes the archive once`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.socket.connections[0].send(gps([bus("bus-a")]));
          h.objects.setFailing(true);
          yield* fleet.shutdown;
          h.objects.setFailing(false);
        }),
      );
      assert.deepEqual(h.objects.puts.filter((put) => put.key.startsWith("raw/")), []);
    }));

  test(`${name}: failing archive writes keep rows pending, alert after 15 minutes, and recover`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      const result = await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.objects.setFailing(true);
          h.socket.connections[0].send(gps([bus("bus-a")]));
          for (let minute = 1; minute <= 21; minute++) {
            yield* TestClock.adjust(MINUTE);
            h.socket.connections.filter((connection) => connection.isOpen()).at(-1)?.send(gps([bus("bus-a", 6.9, T0 + minute * MINUTE)]));
            yield* fleet.tick;
          }
          const failing = yield* fleet.status;
          h.objects.setFailing(false);
          yield* TestClock.adjust(5 * MINUTE);
          h.socket.connections[0].send(gps([bus("bus-a", 6.9, T0 + 26 * MINUTE)]));
          yield* fleet.tick;
          return { failing, recovered: yield* fleet.status };
        }),
      );
      assert.equal(result.failing.lastArchiveWriteAt, null);
      assert.ok(result.failing.pendingRows > 0);
      assert.equal(result.recovered.pendingRows, 0);
      assert.equal(result.recovered.lastArchiveWriteAt, T0 + 26 * MINUTE);
      assert.deepEqual(h.alerts.sent.map((alert) => alert.title), ["Fleet archive: writes failing", "Fleet archive: writes recovered"]);
      assert.deepEqual(
        h.objects.puts.filter((put) => put.key.startsWith("raw/")).map((put) => put.key),
        [
          "raw/2026-10-12/080500-fleet.ndjson.gz",
          "raw/2026-10-12/081000-fleet.ndjson.gz",
          "raw/2026-10-12/081500-fleet.ndjson.gz",
          "raw/2026-10-12/082000-fleet.ndjson.gz",
          "raw/2026-10-12/082600-fleet.ndjson.gz",
        ],
      );
    }));

  test(`${name}: a stale feed in quiet hours doesn't alert, and alerts from 05:00`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      const early = Date.parse("2026-10-12T04:50:00+05:30");
      await h.seed("session", validSession);
      await h.runFleet(early, (fleet) =>
        Effect.gen(function* () {
          for (let elapsed = 0; elapsed < 10 * MINUTE; elapsed += 5 * SECOND) {
            h.socket.connections.at(-1)?.send(JSON.stringify({ type: "ping" }));
            yield* fleet.tick;
            yield* TestClock.adjust(5 * SECOND);
          }
          assert.deepEqual(h.alerts.sent, []);
          h.socket.connections.at(-1)?.send(JSON.stringify({ type: "ping" }));
          yield* fleet.tick;
        }),
      );
      assert.deepEqual(h.alerts.sent.map((alert) => alert.title), ["Live buses: feed stale"]);
    }));

  test(`${name}: quiet hours don't hold back the login alert`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      const night = Date.parse("2026-10-12T02:00:00+05:30");
      h.upstream.settings.refreshStatus = 400;
      await h.seed("session", { ...validSession, refreshToken: "dead", expiresAt: night - MINUTE });
      await h.runFleet(night, (fleet) => fleet.tick);
      assert.deepEqual(h.alerts.sent.map((alert) => alert.title), ["Live buses are down: login needed"]);
    }));

  test(`${name}: quiet hours don't hold back the archive alert`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      const night = Date.parse("2026-10-12T01:00:00+05:30");
      await h.seed("session", { ...validSession, expiresAt: night + 30 * MINUTE });
      await h.runFleet(night, (fleet) =>
        Effect.gen(function* () {
          yield* fleet.tick;
          h.objects.setFailing(true);
          for (let minute = 1; minute <= 21; minute++) {
            yield* TestClock.adjust(MINUTE);
            h.socket.connections.filter((connection) => connection.isOpen()).at(-1)?.send(gps([bus("bus-a", 6.9, night + minute * MINUTE)]));
            yield* fleet.tick;
          }
          h.objects.setFailing(false);
        }),
      );
      assert.deepEqual(h.alerts.sent.map((alert) => alert.title), ["Fleet archive: writes failing"]);
    }));

  test(`${name}: no positions for 2 minutes raises one feed alert, and positions clear it`, () =>
    withWiring(async (wiring) => {
      const h = harness(wiring);
      await h.seed("session", validSession);
      await h.runFleet(T0, (fleet) =>
        Effect.gen(function* () {
          for (let elapsed = 0; elapsed <= 3 * MINUTE; elapsed += 5 * SECOND) {
            h.socket.connections.at(-1)?.send(JSON.stringify({ type: "ping" }));
            yield* fleet.tick;
            yield* TestClock.adjust(5 * SECOND);
          }
          h.socket.connections.at(-1)?.send(gps([bus("bus-a")]));
          yield* fleet.tick;
        }),
      );
      assert.deepEqual(h.alerts.sent.map((alert) => alert.title), ["Live buses: feed stale", "Live buses: feed back"]);
    }));
}
