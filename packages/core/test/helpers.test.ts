import assert from "node:assert/strict";
import { test } from "node:test";
import { Option } from "effect";
import { COLOMBO_UTC_OFFSET_MS, optional, parseJson } from "@metro/core";

test("the shared helpers behave as their callers expect", () => {
  assert.equal(COLOMBO_UTC_OFFSET_MS, 19_800_000);
  assert.deepEqual(optional("heading", undefined), {});
  assert.deepEqual(optional("heading", 0), { heading: 0 });
  assert.deepEqual(parseJson('{"a":1}'), Option.some({ a: 1 }));
  assert.ok(Option.isNone(parseJson("not json")));
});
