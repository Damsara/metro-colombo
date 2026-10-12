import assert from "node:assert/strict";
import { test } from "node:test";
import { linkPlaces } from "@metro/core";

test("links each place to its stop code and id, dropping unknown stops", () => {
  const place = {
    id: 1,
    name: "Lotus Tower Colombo ",
    name_si: "නෙළුම් කුලුණ",
    name_ta: "தாமரை கோபுரம்",
    category: "Landmark",
    walk_meters: 657,
  };
  const linked = linkPlaces(
    [
      { ...place, nearest_stop_id: 19 },
      { ...place, id: 2, nearest_stop_id: 999 },
    ],
    [{ id: 19, stop_code: "MCC48", eimsky_id: "stop-uuid" }],
  );
  assert.deepEqual(linked, [
    {
      ...place,
      name: "Lotus Tower Colombo",
      stop_code: "MCC48",
      stop_id: "stop-uuid",
    },
  ]);
});
