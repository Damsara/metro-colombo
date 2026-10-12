import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "@metro/core";

test("the core package loads", () => {
  assert.equal(typeof core, "object");
});
