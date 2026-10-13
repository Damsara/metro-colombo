import assert from "node:assert/strict";
import { test } from "node:test";
import { Option, Schema } from "effect";
import {
  colourRoutes,
  Manifest,
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
