import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CROWDING_SQL,
  HOURLY_SQL,
  chartViews,
  routeScale,
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

test("the chart views read the attached catalog and keep the shown SQL", () => {
  const [attach, hourly, crowding] = chartViews("https://x.test/it's.duckdb");
  assert.equal(
    attach,
    "ATTACH 'https://x.test/it''s.duckdb' AS metro (READ_ONLY)",
  );
  assert.match(hourly, /^CREATE OR REPLACE VIEW hourly AS SELECT hour/);
  assert.match(hourly, /FROM metro\.buses_per_hour/);
  assert.match(crowding, /FROM metro\.load_by_route_hour/);
  assert.equal(hourly.endsWith(";"), false);
  assert.match(HOURLY_SQL, /FROM buses_per_hour/);
  assert.match(CROWDING_SQL, /FROM load_by_route_hour/);
});
