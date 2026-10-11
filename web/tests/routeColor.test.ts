import assert from "node:assert/strict";
import { test } from "vitest";
import { routeColor } from "../src/lib/routeColor";
import { palette } from "../src/theme";

test("routes keep their own colour and share one fallback", () => {
  assert.equal(routeColor("#1A5A96"), "#1A5A96");
  assert.equal(routeColor(undefined), palette.muted);
  assert.equal(routeColor(""), palette.muted);
  assert.equal(routeColor("blue"), palette.muted);
});
