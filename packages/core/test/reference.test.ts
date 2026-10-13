import assert from "node:assert/strict";
import { test } from "node:test";
import { Option, Schema } from "effect";
import {
  colourRoutes,
  Manifest,
  OccasionsFile,
  PlacesFile,
  ReferenceStatus,
  RoutesFile,
  StopIdsFile,
  StopsFile,
  ReferenceName,
  sha256Hex,
  type S,
  stopIdsByCode,
  versionedKey,
} from "@metro/core";

test("sha256Hex matches the standard test vector", async () => {
  assert.equal(
    await sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("a versioned key carries the first 16 hex digits of the hash", () => {
  assert.equal(
    versionedKey(ReferenceName.stops("CM06"), "0123456789abcdef0123", "json"),
    "reference/stops/CM06.0123456789abcdef.json",
  );
  assert.equal(
    versionedKey(ReferenceName.gtfs, "f".repeat(64), "zip"),
    "reference/gtfs/static.ffffffffffffffff.zip",
  );
  assert.equal(ReferenceName.path("CM06", "d1"), "paths/CM06/d1");
});

const route = {
  code: "CM06",
  id: "r",
  name: "n",
  status: "active",
  is_favorite: false,
  directions: [],
};

test("a colour is appended as the route's last key, as production writes it", () => {
  assert.equal(
    JSON.stringify(colourRoutes([route], new Map([["CM06", "#491C80"]]))),
    '[{"code":"CM06","id":"r","name":"n","status":"active","is_favorite":false,"directions":[],"color_hex":"#491C80"}]',
  );
});

test("a route with no known colour keeps its own colour in its place", () => {
  const coloured = {
    code: "CM06",
    id: "r",
    name: "n",
    color_hex: "#000000",
    status: "active",
    is_favorite: false,
    directions: [],
  };
  assert.equal(
    JSON.stringify(colourRoutes([coloured], new Map())),
    '[{"code":"CM06","id":"r","name":"n","color_hex":"#000000","status":"active","is_favorite":false,"directions":[]}]',
  );
});

test("a route with no colour anywhere has no color_hex in its JSON", () => {
  assert.equal(
    JSON.stringify(colourRoutes([route], new Map())).includes("color_hex"),
    false,
  );
});

const stop = (stop_code: string, id: string): S.Stop => ({
  id,
  stop_code,
  stop_name_en: stop_code,
  stop_name_si: "",
  stop_name_tm: "",
  sequence_number: 1,
  latitude: 6.9,
  longitude: 79.86,
  status: "active",
});

test("stop codes map to ids, a later list winning as in production", () => {
  assert.deepEqual(
    stopIdsByCode([
      [stop("KCR100", "a"), stop("KCR101", "b")],
      [stop("KCR100", "c")],
    ]),
    { KCR100: "c", KCR101: "b" },
  );
});

test("a manifest decodes and a wrong version does not", () => {
  const decode = Schema.decodeUnknownOption(Manifest);
  assert.ok(
    Option.isSome(
      decode({ version: 1, updated_at: 1, files: { routes: "k" } }),
    ),
  );
  assert.ok(Option.isNone(decode({ version: 2, updated_at: 1, files: {} })));
});

const accepts = (schema: Schema.Decoder<unknown>, value: unknown) =>
  Option.isSome(Schema.decodeUnknownOption(schema)(value));

test("a versioned key rejects a hash that is not 16 or more lowercase hex digits", () => {
  for (const hash of [
    "abc",
    "0123456789abcde",
    "G".repeat(16),
    "A".repeat(16),
  ]) {
    assert.throws(() => versionedKey("routes", hash, "json"));
  }
});

test("a manifest rejects non-string file values, non-objects and missing fields", () => {
  assert.equal(
    accepts(Manifest, { version: 1, updated_at: 1, files: { a: 1 } }),
    false,
  );
  assert.equal(accepts(Manifest, "manifest"), false);
  assert.equal(accepts(Manifest, { version: 1, files: {} }), false);
  assert.equal(accepts(Manifest, { version: 1, updated_at: 1 }), false);
});

const status = {
  checked_at: 1,
  ok: true,
  failed: [],
  consecutive_failures: 0,
  last_success_at: null,
};

test("a reference status decodes and rejects bad values", () => {
  assert.equal(accepts(ReferenceStatus, status), true);
  assert.equal(
    accepts(ReferenceStatus, { ...status, last_success_at: 5 }),
    true,
  );
  assert.equal(accepts(ReferenceStatus, { ...status, ok: "yes" }), false);
  const { last_success_at: _omitted, ...missing } = status;
  assert.equal(accepts(ReferenceStatus, missing), false);
  assert.equal(
    accepts(ReferenceStatus, { ...status, failed: "routes" }),
    false,
  );
  assert.equal(accepts(ReferenceStatus, null), false);
});

test("consecutive failures are a non-negative integer", () => {
  assert.equal(
    accepts(ReferenceStatus, { ...status, consecutive_failures: 3 }),
    true,
  );
  assert.equal(
    accepts(ReferenceStatus, { ...status, consecutive_failures: -1 }),
    false,
  );
  assert.equal(
    accepts(ReferenceStatus, { ...status, consecutive_failures: 1.5 }),
    false,
  );
});

test("the file schemas accept valid files and reject invalid ones", () => {
  assert.equal(accepts(RoutesFile, [route]), true);
  assert.equal(accepts(RoutesFile, [{ ...route, is_favorite: "no" }]), false);
  const stops = {
    route_code: "CM06",
    route_name: "n",
    direction_id: "d1",
    direction_label: "l",
    stops: [stop("KCR100", "a")],
  };
  assert.equal(accepts(StopsFile, [stops]), true);
  assert.equal(accepts(StopsFile, [{ ...stops, stops: [{ id: "a" }] }]), false);
  assert.equal(accepts(StopIdsFile, { KCR100: "a" }), true);
  assert.equal(accepts(StopIdsFile, { KCR100: 1 }), false);
  const place = {
    id: 1,
    name: "n",
    name_si: "s",
    name_ta: "t",
    category: "c",
    walk_meters: 10,
    stop_code: "KCR100",
    stop_id: "a",
  };
  assert.equal(accepts(PlacesFile, [place]), true);
  assert.equal(accepts(PlacesFile, [{ ...place, id: "1" }]), false);
  const occasion = { date: "2099-05-01", kind: "mayDay", title: "May Day" };
  assert.equal(accepts(OccasionsFile, [occasion]), true);
  assert.equal(
    accepts(OccasionsFile, [{ ...occasion, kind: "unknownKind" }]),
    false,
  );
});

test("colourRoutes adds no color_hex key when no colour is known", () => {
  assert.equal("color_hex" in colourRoutes([route], new Map())[0]!, false);
});
