import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const FORBIDDEN =
  /(?:from\s+|import\s*\(?\s*)["'](node:[^"']+|ws|undici|cloudflare:[^"']+|@cloudflare\/[^"']+|@effect\/platform-[^"']+|(?:\.\.\/)+(?:src|apps|core|upstream|fleet|publisher|api)\/[^"']*)["']/;

const root = new URL("../packages", import.meta.url).pathname;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );

test("the boundary covers every shared package", () => {
  assert.deepEqual(readdirSync(root).sort(), [
    "api",
    "core",
    "fleet",
    "publisher",
    "upstream",
  ]);
});

test("shared packages import nothing runtime-specific", () => {
  const offenders = readdirSync(root).flatMap((name) =>
    sources(join(root, name, "src")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => FORBIDDEN.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    ),
  );
  assert.deepEqual(offenders, []);
});
