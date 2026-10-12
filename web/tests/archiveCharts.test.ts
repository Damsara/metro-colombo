import assert from "node:assert/strict";
import { test } from "vitest";
import {
  chartView,
  forStop,
  routeScale,
  setupStatements,
  withoutLimit,
} from "../src/lib/archiveCharts";
import { palette } from "../src/theme";

test("routes get their own colour in code order, once each", () => {
  assert.deepEqual(
    routeScale([
      { code: "CM03", color_hex: "#7a1f2b" },
      { code: "CM01", color_hex: "#147d57" },
      { code: "CM03", color_hex: "#000000" },
    ]),
    { domain: ["CM01", "CM03"], range: ["#147d57", "#7a1f2b"] },
  );
});

test("a route without a usable colour falls back like the map does", () => {
  assert.deepEqual(routeScale([{ code: "CM09", color_hex: "red" }]), {
    domain: ["CM09"],
    range: [palette.muted],
  });
});

test("setup attaches the catalog and lets local views read it by bare names", () => {
  const [attach, path, hourly] = setupStatements("https://x.test/it's.duckdb");
  assert.equal(
    attach,
    "ATTACH 'https://x.test/it''s.duckdb' AS metro (READ_ONLY)",
  );
  assert.equal(path, "SET search_path = 'memory.main,metro.main'");
  assert.match(
    hourly,
    /^CREATE OR REPLACE VIEW hourly AS SELECT \* FROM \(SELECT hour/,
  );
});

test("a chart view wraps an example's query and can add columns", () => {
  assert.equal(
    chartView("ex", "SELECT 1 AS a\nFROM t;\n", "a * 2 AS b"),
    "CREATE OR REPLACE VIEW ex AS SELECT *, a * 2 AS b FROM (SELECT 1 AS a\nFROM t)",
  );
});

test("charts can drop the example's row limit", () => {
  assert.equal(
    withoutLimit("SELECT 1\nORDER BY x\nLIMIT 20;"),
    "SELECT 1\nORDER BY x",
  );
  assert.equal(withoutLimit("SELECT 1;"), "SELECT 1");
});

test("the stop in the gaps query can be swapped safely", () => {
  assert.equal(
    forStop("WHERE stop_code = 'MCC5'", "MCC68-2"),
    "WHERE stop_code = 'MCC68-2'",
  );
  assert.equal(forStop("= 'MCC5'", "x'y"), "= 'x''y'");
});
