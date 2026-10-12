import assert from "node:assert/strict";
import { test } from "vitest";
import { cellKind, formatCell } from "../src/lib/resultCells";

test("archive times show as Colombo wall-clock, not shifted to the reader's zone", () => {
  const ms = Date.UTC(2026, 9, 12, 7, 5, 30);
  assert.equal(formatCell(ms, cellKind(10)), "2026-10-12 07:05");
  assert.equal(formatCell(new Date(ms), "timestamp"), "2026-10-12 07:05");
  assert.equal(formatCell(ms, cellKind(8)), "2026-10-12");
});

test("numbers are rounded for reading, whole numbers and big ints kept", () => {
  assert.equal(formatCell(0.157142857), "0.16");
  assert.equal(formatCell(6.82536033), "6.83");
  assert.equal(formatCell(42), "42");
  assert.equal(formatCell(12345678901234567890n), "12345678901234567890");
});

test("lists read as comma-separated values and missing values as a dash", () => {
  assert.equal(formatCell(["CM01", "CM03"]), "CM01, CM03");
  assert.equal(formatCell(new Float64Array([0.255, 3.1])), "0.26, 3.1");
  assert.equal(formatCell(null), "–");
  assert.equal(formatCell("WP-NE-6543"), "WP-NE-6543");
});
