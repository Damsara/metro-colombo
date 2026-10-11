import assert from "node:assert/strict";
import { test } from "vitest";
import {
  busJourney,
  journeyStrip,
  type JourneyMarks,
} from "../src/lib/busCard";
import { orderedStops } from "../src/lib/tracking";
import type { Stop } from "../src/types";

function stopAt(id: string, index: number): Stop {
  return {
    id,
    stop_code: id,
    stop_name_en: id,
    stop_name_si: id,
    stop_name_tm: id,
    latitude: 6.8 + index * 0.01,
    longitude: 79.9,
    sequence_number: index + 1,
  };
}

const line = Array.from("abcdefghij", stopAt);
function journey(position: number, marks?: JourneyMarks) {
  const result = busJourney("CM01", "d1", line, position, marks);
  assert.ok(result);
  return result;
}
function strip(position: number, marks?: JourneyMarks, maxAhead?: number) {
  return journeyStrip(journey(position, marks), maxAhead).map((item) =>
    item.kind === "stop"
      ? item.stop.stop.id
      : item.kind === "bus"
        ? "bus"
        : `+${item.count}`,
  );
}

test("at a stop the journey has passed, here, next and ahead stops", () => {
  const result = journey(1);
  assert.equal(result.routeCode, "CM01");
  assert.equal(result.directionId, "d1");
  assert.equal(result.position, 1);
  assert.equal(result.lastPassed?.stop.id, "a");
  assert.equal(result.lastPassed?.state, "passed");
  assert.deepEqual(
    result.ahead
      .slice(0, 3)
      .map(({ stop, index, state }) => [stop.id, index, state]),
    [
      ["b", 1, "here"],
      ["c", 2, "next"],
      ["d", 3, "ahead"],
    ],
  );
  assert.equal(result.terminus, result.ahead.at(-1));
  assert.equal(result.board, null);
  assert.equal(result.alight, null);
  assert.equal(result.stopsToBoard, null);
});

test("between stops the next stop leads the remaining journey", () => {
  const result = journey(1.5);
  assert.equal(result.lastPassed?.stop.id, "b");
  assert.equal(result.lastPassed?.state, "passed");
  assert.deepEqual(
    result.ahead.map(({ state }) => state),
    ["next", ...Array(7).fill("ahead")],
  );
  assert.equal(result.ahead[0].stop.id, "c");
  assert.equal(journey(-0.5).lastPassed, null);
  assert.equal(journey(-0.5).ahead[0].state, "next");
  assert.equal(journey(0).ahead[0].state, "here");
});

test("ordering stops by sequence is stable and leaves the caller's stops untouched", () => {
  const reversed = [...line].reverse();
  const result = busJourney("CM01", "d1", orderedStops(reversed), 1.5);
  assert.equal(result?.lastPassed?.stop.id, "b");
  assert.equal(result?.ahead[0].stop.id, "c");
  assert.equal(reversed[0].id, "j");
  const missingSequence = line
    .slice(0, 3)
    .map((stop) => ({ ...stop, sequence_number: undefined }));
  assert.deepEqual(
    orderedStops(missingSequence).map((stop) => stop.id),
    ["a", "b", "c"],
  );
});

test("marks match ids and boarding counts include the boarding stop", () => {
  for (const [position, remaining] of [
    [0, 3],
    [1.5, 2],
    [3, 0],
    [3.5, null],
  ] as const) {
    const result = journey(position, { boardId: "d", alightId: "h" });
    assert.equal(result.board?.stop.id, "d");
    assert.equal(result.board?.mark, "board");
    assert.equal(result.alight?.stop.id, "h");
    assert.equal(result.alight?.mark, "alight");
    assert.equal(result.stopsToBoard, remaining);
  }
  assert.equal(
    journey(0, { boardId: "missing", alightId: "missing" }).board,
    null,
  );
  assert.equal(journey(0, { alightId: "h" }).alight?.mark, "alight");
  const before = journey(0, { boardId: "h", alightId: "d" });
  assert.equal(before.alight, null);
  assert.equal(before.ahead[3].mark, undefined);
  const same = journey(0, { boardId: "d", alightId: "d" });
  assert.equal(same.board, same.alight);
  assert.equal(same.board?.mark, "board");
});

test("a loop's alighting mark uses the visit at or after boarding", () => {
  const loop = [...line.slice(0, 4), { ...line[0], sequence_number: 5 }];
  const result = busJourney("CM01", "d1", loop, 0, {
    boardId: "b",
    alightId: "a",
  });
  assert.equal(result?.board?.index, 1);
  assert.equal(result?.alight?.index, 4);
  assert.equal(result?.ahead[0].mark, undefined);
});

test("the terminus is included while there and no journey remains past it", () => {
  const result = journey(9);
  assert.deepEqual(result.ahead, [result.terminus]);
  assert.equal(result.terminus.state, "here");
  assert.equal(result.lastPassed?.index, 8);
  for (const position of [null, 9.5, 10, NaN, Infinity])
    assert.equal(busJourney("CM01", "d1", line, position), null);
  assert.equal(busJourney("CM01", "d1", [], 0), null);
});

test("the strip includes the bus, nearest stops, gap and terminus", () => {
  assert.deepEqual(strip(-0.5), ["bus", "a", "b", "c", "+6", "j"]);
  assert.deepEqual(strip(1), ["a", "bus", "b", "c", "d", "+5", "j"]);
  assert.deepEqual(strip(1.5), ["b", "bus", "c", "d", "e", "+4", "j"]);
  assert.deepEqual(strip(8.5), ["i", "bus", "j"]);
  assert.deepEqual(strip(9), ["i", "bus", "j"]);
});

test("distant marks split gaps without losing intervening stop counts", () => {
  assert.deepEqual(strip(0.5, { boardId: "f", alightId: "h" }), [
    "a",
    "bus",
    "b",
    "c",
    "d",
    "+1",
    "f",
    "+1",
    "h",
    "+1",
    "j",
  ]);
  assert.deepEqual(strip(0.5, { boardId: "b", alightId: "j" }), [
    "a",
    "bus",
    "b",
    "c",
    "d",
    "+5",
    "j",
  ]);
  assert.deepEqual(strip(0.5, { boardId: "j", alightId: "j" }), [
    "a",
    "bus",
    "b",
    "c",
    "d",
    "+5",
    "j",
  ]);
});

test("the strip keeps passed marks in journey order and never repeats a visit", () => {
  assert.deepEqual(strip(6.5, { boardId: "b", alightId: "d" }), [
    "b",
    "+1",
    "d",
    "+2",
    "g",
    "bus",
    "h",
    "i",
    "j",
  ]);
  for (const position of [-0.5, 0, 0.5, 3, 8.5, 9]) {
    for (const maxAhead of [0, 1, 3, 20]) {
      const result = journeyStrip(
        journey(position, { boardId: "b", alightId: "j" }),
        maxAhead,
      );
      const indexes = result.flatMap((item) =>
        item.kind === "stop" ? [item.stop.index] : [],
      );
      assert.equal(new Set(indexes).size, indexes.length);
      assert.ok(indexes.includes(1));
      assert.ok(indexes.includes(9));
      assert.equal(result.filter((item) => item.kind === "bus").length, 1);
      assert.ok(result.every((item) => item.kind !== "gap" || item.count > 0));
    }
  }
});

test("maxAhead zero still counts all skipped stops and keeps the terminus", () => {
  assert.deepEqual(strip(-0.5, undefined, 0), ["bus", "+9", "j"]);
  assert.deepEqual(strip(1.5, undefined, 0), ["b", "bus", "+7", "j"]);
  assert.deepEqual(strip(1.5, undefined, 1), ["b", "bus", "c", "+6", "j"]);
});
