import assert from "node:assert/strict";
import { test } from "vitest";
import {
  colomboDate,
  festiveOff,
  festiveStops,
  hubStops,
  markMomentPlayed,
  parseOccasionKind,
  setFestiveOff,
  shouldPlayMoment,
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

const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};
const throwingStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};
const vesak: Occasion = { date: "2026-05-01", kind: "vesak", title: "Vesak" };

test("the moment plays once per occasion per day", () => {
  const store = memoryStore();
  const played = new Set<string>();
  assert.equal(shouldPlayMoment(store, vesak, played), true);
  markMomentPlayed(store, vesak, played);
  assert.equal(shouldPlayMoment(store, vesak, new Set()), false);
  assert.equal(
    shouldPlayMoment(store, { ...vesak, date: "2026-05-02" }, new Set()),
    true,
  );
});

test("without storage the moment still plays only once per page load", () => {
  const played = new Set<string>();
  assert.equal(shouldPlayMoment(throwingStore, vesak, played), true);
  markMomentPlayed(throwingStore, vesak, played);
  assert.equal(shouldPlayMoment(throwingStore, vesak, played), false);
});

test("the off switch is remembered and survives broken storage", () => {
  const store = memoryStore();
  assert.equal(festiveOff(store), false);
  setFestiveOff(store, true);
  assert.equal(festiveOff(store), true);
  setFestiveOff(store, false);
  assert.equal(festiveOff(store), false);
  assert.equal(festiveOff(throwingStore), false);
  assert.doesNotThrow(() => setFestiveOff(throwingStore, true));
});

const s = (id: string) => ({
  id,
  stop_code: id,
  stop_name_en: id,
  stop_name_si: "",
  stop_name_tm: "",
  latitude: 6.9,
  longitude: 79.9,
});

test("marks the first non-empty source, never the whole network", () => {
  assert.deepEqual(
    festiveStops([[s("a"), s("a"), s("b")], [s("c")]]).map((x) => x.id),
    ["a", "b"],
  );
  assert.deepEqual(
    festiveStops([[], [], [s("c")]]).map((x) => x.id),
    ["c"],
  );
  assert.equal(
    festiveStops([[], Array.from({ length: 200 }, (_, i) => s(`${i}`))]).length,
    80,
  );
});

test("the selected stop always gets a lantern, once", () => {
  assert.deepEqual(
    festiveStops([[s("a"), s("b")]], [s("b")]).map((x) => x.id),
    ["b", "a"],
  );
  assert.deepEqual(
    festiveStops([[]], [s("z")]).map((x) => x.id),
    ["z"],
  );
});

test("hubs are the stops most routes share", () => {
  const hub = (id: string, routes: string[], north = 0) => ({
    ...s(id),
    routes,
    latitude: 6.9 + north,
  });
  const stops = [
    hub("quiet", ["CM01"]),
    hub("pair", ["CM01", "CM02"], 0.02),
    hub("fort", ["CM01", "CM02", "CM03"]),
    hub("other-pair", ["CM04", "CM05"], 0.04),
  ];
  assert.deepEqual(
    hubStops(stops).map((x) => x.id),
    ["fort", "other-pair", "pair"],
  );
  assert.deepEqual(
    hubStops(stops, 1).map((x) => x.id),
    ["fort"],
  );
});

test("hubs keep their distance so lanterns don't pile up", () => {
  const near = { ...s("near"), routes: ["CM01", "CM02"], latitude: 6.9031 };
  const fort = { ...s("fort"), routes: ["CM01", "CM02", "CM03"] };
  assert.deepEqual(
    hubStops([near, fort]).map((x) => x.id),
    ["fort"],
  );
});
