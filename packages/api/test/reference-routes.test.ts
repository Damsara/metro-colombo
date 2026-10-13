import assert from "node:assert/strict";
import { test } from "node:test";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { upcomingFrom } from "@metro/core";
import { ReferenceRoutes } from "@metro/api";
import {
  CM06,
  GEOMETRY,
  OCCASIONS,
  PLACES,
  REFERENCE,
  ROUTES,
  STOPS_CM01,
  STOPS_CM06,
} from "./support/fixtures.ts";
import { harness, type HarnessOptions } from "./support/harness.ts";

const REFERENCE_CACHE = "public, max-age=3600, stale-while-revalidate=86400";
const GEOMETRY_CACHE = "public, max-age=86400, stale-while-revalidate=604800";
const UNAVAILABLE = '{"error":"transit data is temporarily unavailable"}';

const site = (options: HarnessOptions = {}) =>
  harness(
    Layer.mergeAll(
      ReferenceRoutes,
      HttpRouter.cors({ allowedMethods: ["GET"] }),
    ),
    options,
  );

const expectJson = async (
  response: Response,
  status: number,
  body: string,
  cache: string | null,
) => {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("cache-control"), cache);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(await response.text(), body);
};

test("/api/routes is production's body, byte for byte, with colours last", async () => {
  const { get } = await site();
  await expectJson(
    await get("/api/routes"),
    200,
    JSON.stringify({ routes: ROUTES }),
    REFERENCE_CACHE,
  );
});

test("a route is found by its code in any case", async () => {
  const { get } = await site();
  await expectJson(
    await get("/api/routes/cm06"),
    200,
    JSON.stringify(CM06),
    REFERENCE_CACHE,
  );
});

test("an unknown route is 404 and never cached", async () => {
  const { get } = await site();
  await expectJson(
    await get("/api/routes/XX1"),
    404,
    '{"error":"route not found: XX1"}',
    "no-store",
  );
});

test("geometry is the first direction unless one is chosen by index, forward or reverse, id or start", async () => {
  const { get } = await site();
  const cases: Array<[string, unknown]> = [
    ["", GEOMETRY.d1],
    ["?direction=0", GEOMETRY.d1],
    ["?direction=1", GEOMETRY.d2],
    ["?direction=forward", GEOMETRY.d1],
    ["?direction=reverse", GEOMETRY.d2],
    ["?direction=d2", GEOMETRY.d2],
    ["?direction=bambalapitiya", GEOMETRY.d2],
  ];
  for (const [query, body] of cases)
    await expectJson(
      await get(`/api/routes/CM06/geometry${query}`),
      200,
      JSON.stringify(body),
      GEOMETRY_CACHE,
    );
});

test("an invalid direction is 400 for geometry and stops", async () => {
  const { get } = await site();
  for (const what of ["geometry", "stops"])
    await expectJson(
      await get(`/api/routes/CM06/${what}?direction=9`),
      400,
      '{"error":"invalid direction for CM06"}',
      "no-store",
    );
});

test("stops for several directions come wrapped, and one direction alone", async () => {
  const { get } = await site();
  await expectJson(
    await get("/api/routes/CM06/stops"),
    200,
    JSON.stringify({ directions: STOPS_CM06 }),
    REFERENCE_CACHE,
  );
  await expectJson(
    await get("/api/routes/CM06/stops?direction=1"),
    200,
    JSON.stringify(STOPS_CM06[1]),
    REFERENCE_CACHE,
  );
  await expectJson(
    await get("/api/routes/CM01/stops"),
    200,
    JSON.stringify(STOPS_CM01[0]),
    REFERENCE_CACHE,
  );
});

test("places are wrapped as production wraps them", async () => {
  const { get } = await site();
  await expectJson(
    await get("/api/places"),
    200,
    JSON.stringify({ places: PLACES }),
    REFERENCE_CACHE,
  );
});

test("occasions start from today in Colombo", async () => {
  const before = await site({ at: Date.parse("2026-10-12T18:29:59Z") });
  await expectJson(
    await before.get("/api/occasions"),
    200,
    JSON.stringify({
      occasions: upcomingFrom(OCCASIONS as never, "2026-10-12"),
    }),
    REFERENCE_CACHE,
  );
  const after = await site({ at: Date.parse("2026-10-12T18:30:00Z") });
  const body = await (await after.get("/api/occasions")).text();
  assert.equal(
    body,
    JSON.stringify({
      occasions: upcomingFrom(OCCASIONS as never, "2026-10-13"),
    }),
  );
  assert.equal(body.includes("Yesterday"), false);
});

test("an unknown API path or method is production's bare 404", async () => {
  const { get } = await site();
  await expectJson(await get("/api/nope"), 404, '{"error":"not found"}', null);
  await expectJson(
    await get("/api/routes", { method: "POST" }),
    404,
    '{"error":"not found"}',
    null,
  );
});

test("with nothing published, or a file missing, the API is 502 and not cached", async () => {
  const empty = await site({ reference: null });
  await expectJson(
    await empty.get("/api/routes"),
    502,
    UNAVAILABLE,
    "no-store",
  );
  const partial = await site({
    reference: {
      ...REFERENCE,
      "stops/CM06": [STOPS_CM06[0]],
      "paths/CM06/d2": "{",
    },
  });
  await expectJson(
    await partial.get("/api/routes/CM06/stops?direction=1"),
    502,
    UNAVAILABLE,
    "no-store",
  );
  await expectJson(
    await partial.get("/api/routes/CM06/geometry?direction=1"),
    502,
    UNAVAILABLE,
    "no-store",
  );
});

test("a CORS preflight allows GET, as production's does", async () => {
  const { get } = await site();
  const response = await get("/api/routes", {
    method: "OPTIONS",
    headers: {
      origin: "https://example.org",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-methods"), "GET");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});
