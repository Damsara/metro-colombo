import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertReadOnly,
  type BodyRule,
  type Captured,
  compare,
  type Probe,
} from "../src/compat/compare.ts";
import { probes } from "../src/compat/requests.ts";

const captured = (
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
  status = 200,
): Captured => ({ status, headers, body: new TextEncoder().encode(body) });
const probe = (body: BodyRule, extra: Partial<Probe> = {}): Probe => ({
  name: "p",
  method: "GET",
  path: "/x",
  body,
  ...extra,
});

const ROUTES = [
  {
    code: "CM06",
    directions: [
      { id: "d1", start_location: "Kollupitiya" },
      { id: "d2", start_location: "Bambalapitiya" },
    ],
  },
];
const PAIR = { fromCode: "KCR100", toCode: "KCR101", fromId: "a", toId: "b" };

test("identical responses have no differences", () => {
  assert.deepEqual(
    compare(probe("bytes"), captured('{"a":1}'), captured('{"a":1}')),
    [],
  );
});

test("status and compared headers are reported, and other headers ignored", () => {
  const base = captured("x", { date: "Mon", "cache-control": "no-store" }, 200);
  const candidate = captured(
    "x",
    { date: "Tue", "cache-control": "public" },
    404,
  );
  assert.deepEqual(
    compare(probe("bytes"), base, candidate).map((d) => d.what),
    ["status", "header cache-control"],
  );
});

test("a body difference says where it starts", () => {
  const [difference] = compare(
    probe("bytes"),
    captured('{"a":1,"b":2}'),
    captured('{"a":1,"b":3}'),
  );
  assert.equal(difference.what, "body (first difference at character 11)");
});

test("live bodies may differ in buses but not in keys", () => {
  const base = captured(
    '{"success":true,"count":1,"timestamp":1,"age_ms":5,"buses":[{"id":"a","lat":1,"lng":2,"route_code":"CM06"}]}',
  );
  assert.deepEqual(
    compare(
      probe("live"),
      base,
      captured('{"success":false,"count":0,"timestamp":0,"buses":[]}'),
    ),
    [],
  );
  assert.equal(
    compare(
      probe("live"),
      base,
      captured(
        '{"success":true,"count":0,"timestamp":0,"buses":[],"stale":false}',
      ),
    ).length,
    1,
  );
});

test("health may add live and reference_age_ms and must agree on the rest", () => {
  const base = captured('{"ok":true,"routes_count":7,"upstream":"reachable"}');
  assert.deepEqual(
    compare(
      probe("health"),
      base,
      captured(
        '{"ok":true,"routes_count":7,"upstream":"reachable","live":null,"reference_age_ms":5}',
      ),
    ),
    [],
  );
  assert.deepEqual(
    compare(
      probe("health"),
      base,
      captured(
        '{"ok":true,"routes_count":6,"upstream":"reachable","login":"ok"}',
      ),
    ).map((d) => d.what),
    ["health routes_count", "health keys"],
  );
});

test("journeys are compared without queried_at, keeping key order", () => {
  const a = captured('{"date":"2026-10-13","queried_at":"x","options":[]}');
  assert.deepEqual(
    compare(
      probe("journey"),
      a,
      captured('{"date":"2026-10-13","queried_at":"y","options":[]}'),
    ),
    [],
  );
  assert.equal(
    compare(
      probe("journey"),
      a,
      captured('{"options":[],"date":"2026-10-13","queried_at":"x"}'),
    ).length,
    1,
  );
});

test("skipped headers aren't compared and 'none' ignores the body", () => {
  const p = probe("none", { skipHeaders: ["etag"] });
  assert.deepEqual(
    compare(p, captured("a", { etag: "1" }), captured("b", { etag: "2" })),
    [],
  );
});

test("a content-length present on one side only is reported, and its value is not compared", () => {
  const type = { "content-type": "application/json" };
  const withLength = captured("x", { ...type, "content-length": "1" });
  const summary = (base: Captured, candidate: Captured) =>
    compare(probe("bytes"), base, candidate).map((d) => [
      d.what,
      d.base,
      d.candidate,
    ]);
  assert.deepEqual(summary(withLength, captured("x")), [
    ["content-length presence", "present", "absent"],
  ]);
  assert.deepEqual(summary(captured("x"), withLength), [
    ["content-length presence", "absent", "present"],
  ]);
  assert.deepEqual(
    summary(withLength, captured("x", { ...type, "content-length": "99" })),
    [],
  );
});

test("only GET, HEAD and OPTIONS are ever sent", () => {
  assert.throws(
    () => assertReadOnly({ method: "POST", path: "/fleet/otp" }),
    /only reads/,
  );
  for (const each of probes(ROUTES, PAIR, '"etag"'))
    assert.doesNotThrow(() => assertReadOnly(each));
});

test("every direction is probed by index, forward or reverse, id and start", () => {
  const names = probes(ROUTES, PAIR, undefined).map((p) => p.name);
  for (const name of [
    "geometry CM06 1",
    "stops CM06 reverse",
    "geometry CM06 d2",
    "stops CM06 Bambalapitiya",
    "route CM06 lower case",
    "journey by stop code",
    "catalog range",
  ])
    assert.ok(names.includes(name), name);
  assert.equal(names.includes("catalog not modified"), false);
  assert.ok(
    probes(ROUTES, PAIR, '"e"').some((p) => p.name === "catalog not modified"),
  );
});
