import assert from "node:assert/strict";
import { test } from "vitest";
import { duckdbShellLink } from "../src/lib/duckdbShell";

test("a shell link matches the one the shell's own Share button makes", () => {
  assert.equal(
    duckdbShellLink([
      "ATTACH 'https://data.metro.manasa.ai/catalog/metro.duckdb' AS metro;",
      "USE metro;",
      "SELECT route_code, count(*) AS stops FROM stops GROUP BY ALL ORDER BY 1;",
    ]),
    "https://shell.duckdb.org/#queries=v0,ATTACH-'https%3A%2F%2Fdata.metro.manasa.ai%2Fcatalog%2Fmetro.duckdb'-AS-metro~,USE-metro~,SELECT-route_code%2C-count(*)-AS-stops-FROM-stops-GROUP-BY-ALL-ORDER-BY-1~",
  );
});

test("hyphens and tildes in a query survive the shell's separators", () => {
  assert.equal(
    duckdbShellLink(["SELECT 5 - 2 AS x, 'a~b' AS y, '2026-10-13' AS d;"]),
    "https://shell.duckdb.org/#queries=v0,SELECT-5-%20-2-AS-x%2C-'a%3Bb'-AS-y%2C-'2026%2010%2013'-AS-d~",
  );
});

test("a multi-line query goes into the link on one line", () => {
  assert.equal(
    duckdbShellLink(["SELECT 1\n  FROM t;"]),
    "https://shell.duckdb.org/#queries=v0,SELECT-1-FROM-t~",
  );
});
