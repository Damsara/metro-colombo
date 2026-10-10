import assert from "node:assert/strict";
import { test } from "vitest";
import {
  sameStop,
  secondaryStopName,
  servedBy,
  stopActions,
} from "../src/lib/stopCard";
import type { Stop } from "../src/types";

const stop = (id: string, en: string, si = "", ta = ""): Stop => ({
  id,
  stop_code: id.toUpperCase(),
  stop_name_en: en,
  stop_name_si: si,
  stop_name_tm: ta,
  latitude: 6.9,
  longitude: 79.9,
});

const kottawa = stop("k1", "Kottawa", "කොට්ටාව", "கொட்டாவ");
const fort = stop("f1", "Colombo Fort", "කොළඹ කොටුව");
const maharagama = stop("m1", "Maharagama");

test("routes are grouped with every place they head for", () => {
  assert.deepEqual(
    servedBy(
      [
        { route: "CM10", towards: "Makumbura" },
        { route: "CM02", towards: "Colombo Fort" },
        { route: "CM10", towards: "COLOMBO FORT" },
        { route: "CM02", towards: "Kottawa" },
        { route: "CM02", towards: "colombo fort" },
      ],
      "Maharagama",
    ),
    [
      { route: "CM02", towards: ["Colombo Fort", "Kottawa"] },
      { route: "CM10", towards: ["Makumbura", "COLOMBO FORT"] },
    ],
  );
});

test("a direction ending at the stop isn't listed as somewhere to go", () => {
  assert.deepEqual(
    servedBy(
      [
        { route: "CM01", towards: "Kottawa" },
        { route: "CM01", towards: "Colombo Fort" },
        { route: "CM07", towards: "Kottawa " },
      ],
      "kottawa",
    ),
    [
      { route: "CM01", towards: ["Colombo Fort"] },
      { route: "CM07", towards: [] },
    ],
  );
});

test("route codes sort in number order", () => {
  assert.deepEqual(
    servedBy(
      [{ route: "CM10" }, { route: "CM9" }, { route: "CM2" }],
      "Anywhere",
    ).map((item) => item.route),
    ["CM2", "CM9", "CM10"],
  );
  assert.deepEqual(servedBy(undefined, "Anywhere"), []);
});

test("the secondary name is another language's, never a repeat", () => {
  assert.equal(secondaryStopName(kottawa, "en"), "කොට්ටාව");
  assert.equal(secondaryStopName(kottawa, "si"), "Kottawa");
  assert.equal(secondaryStopName(kottawa, "ta"), "Kottawa");
  // No Sinhala name: the Sinhala view falls back to English, so no repeat.
  assert.equal(secondaryStopName(maharagama, "si"), undefined);
  assert.equal(secondaryStopName(maharagama, "en"), undefined);
});

test("catalog stops match any of their merged ids", () => {
  assert.ok(sameStop(kottawa, { ...stop("k2", "Kottawa"), ids: ["k2", "k1"] }));
  assert.ok(sameStop(kottawa, kottawa));
  assert.ok(!sameStop(kottawa, fort));
});

test("with nothing set, going here leads", () => {
  assert.deepEqual(stopActions(kottawa, null, null), {
    primary: "to",
    current: null,
    completes: null,
  });
});

test("with a start set, going here completes the trip", () => {
  assert.deepEqual(stopActions(kottawa, fort, null), {
    primary: "to",
    current: null,
    completes: { from: fort },
  });
  // A destination elsewhere doesn't change that; going here replaces it.
  assert.equal(stopActions(kottawa, fort, maharagama).primary, "to");
});

test("with only a destination set, starting here completes the trip", () => {
  assert.deepEqual(stopActions(kottawa, null, fort), {
    primary: "from",
    current: null,
    completes: { to: fort },
  });
});

test("a stop that is already one end of the trip says so", () => {
  // Already the start, with a destination: search from here.
  assert.deepEqual(stopActions(kottawa, kottawa, fort), {
    primary: "from",
    current: "from",
    completes: { to: fort },
  });
  // Already the destination, with a start: search to here.
  assert.deepEqual(stopActions(kottawa, fort, kottawa), {
    primary: "to",
    current: "to",
    completes: { from: fort },
  });
  // Already the start and nothing else: no trip to complete.
  assert.deepEqual(stopActions(kottawa, kottawa, null), {
    primary: "to",
    current: "from",
    completes: null,
  });
});
