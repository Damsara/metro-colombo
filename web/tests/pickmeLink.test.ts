import assert from "node:assert/strict";
import { test } from "vitest";
import {
  PICKME_APP_LINK,
  PICKME_STORE_URL,
  PICKME_TRIP,
  pickmeLink,
  pickmeTripLink,
} from "../src/lib/pickmeLink";

const fort = { lat: 6.9335, lng: 79.85 };
const independenceSquare = { lat: 6.9061, lng: 79.8686 };

test("with nothing harvested the trip link is the bare app link", () => {
  assert.equal(PICKME_TRIP.pickup, "");
  assert.equal(pickmeTripLink(fort, independenceSquare), PICKME_APP_LINK);
});

test("a harvested template carries the pickup and drop", () => {
  const link = pickmeTripLink(fort, independenceSquare, {
    path: "/ride",
    pickup: "pickup",
    drop: "drop",
  });
  const url = new URL(link);
  assert.equal(`${url.origin}${url.pathname}`, "https://app.pickme.lk/ride");
  assert.equal(url.searchParams.get("pickup"), "6.9335,79.85");
  assert.equal(url.searchParams.get("drop"), "6.9061,79.8686");
});

test("parameters are encoded rather than concatenated", () => {
  assert.equal(
    pickmeLink("/x", { q: "a&b=c" }),
    "https://app.pickme.lk/x?q=a%26b%3Dc",
  );
});

test("a nameless parameter is dropped", () => {
  assert.equal(pickmeLink("", { "": "ignored" }), PICKME_APP_LINK);
});

test("the store fallback points at the passenger package", () => {
  assert.ok(PICKME_STORE_URL.endsWith("id=com.pickme.passenger"));
});
