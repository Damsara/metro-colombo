import assert from "node:assert/strict";
import { test } from "vitest";
import { isKonami, KONAMI, pushKey } from "../src/lib/konami";

const type = (keys: readonly string[]) => keys.reduce(pushKey, [] as string[]);

test("the full sequence matches", () => {
  assert.ok(isKonami(type(KONAMI)));
});

test("extra presses before the sequence still match", () => {
  assert.ok(isKonami(type(["ArrowUp", "x", "ArrowUp", ...KONAMI])));
});

test("caps lock still matches", () => {
  assert.ok(isKonami(type([...KONAMI.slice(0, 8), "B", "A"])));
});

test("a wrong key or a short sequence does not match", () => {
  assert.ok(!isKonami(type(KONAMI.slice(1))));
  assert.ok(!isKonami(type([...KONAMI.slice(0, 9), "b"])));
});
