import assert from "node:assert/strict";
import { test } from "vitest";
import {
  colomboDate,
  parseOccasionKind,
  todaysOccasion,
} from "../src/lib/occasions";
import type { Occasion } from "../src/occasions/types";

const list: Occasion[] = [
  { date: "2026-05-01", kind: "mayDay", title: "May Day" },
  { date: "2026-05-01", kind: "vesak", title: "Vesak Full Moon Poya Day" },
  { date: "2026-10-25", kind: "poya", title: "Vap Full Moon Poya Day" },
];

test("today is the Colombo date, whatever the device timezone", () => {
  assert.equal(colomboDate(new Date("2026-10-24T23:30:00Z")), "2026-10-25");
  assert.equal(colomboDate(new Date("2026-10-24T18:00:00Z")), "2026-10-24");
});

test("the higher-priority occasion wins a shared date", () => {
  assert.equal(todaysOccasion(list, "2026-05-01", null)?.kind, "vesak");
});

test("no occasion on an ordinary day", () => {
  assert.equal(todaysOccasion(list, "2026-05-02", null), null);
});

test("a preview shows any theme on any day", () => {
  assert.deepEqual(todaysOccasion(list, "2026-05-02", "christmas"), {
    date: "2026-05-02",
    kind: "christmas",
    title: "christmas",
  });
});

test("unknown preview values are ignored", () => {
  assert.equal(parseOccasionKind("nonsense"), null);
  assert.equal(parseOccasionKind(42), null);
  assert.equal(parseOccasionKind("deepavali"), "deepavali");
});
