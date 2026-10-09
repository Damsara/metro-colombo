import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JourneyResults from "../src/components/JourneyResults";
import { LanguageProvider } from "../src/lib/language";
import type { JourneyOption, JourneyPlan, LiveBus } from "../src/types";

// Actual Panadura -> Battaramulla capture, reduced to rendered fields; booking token omitted.
const option: JourneyOption = JSON.parse(
  readFileSync(
    new URL("./fixtures/transfer-option.json", import.meta.url),
    "utf8",
  ),
);
const plan: JourneyPlan = {
  from_stop:
    option.legs[0].kind === "ride"
      ? option.legs[0].ride.board
      : option.legs[0].move.from_stop,
  to_stop:
    option.legs[2].kind === "ride"
      ? option.legs[2].ride.alight
      : option.legs[2].move.to_stop,
  date: new Date(Date.now() + 86400000 + 5.5 * 3600000)
    .toISOString()
    .slice(0, 10),
  queried_at: "2026-10-07T06:00:00Z",
  is_now: false,
  options: [option],
};

// Renders in the provider tree the app uses; the language is English unless a
// test switches it.
function markup(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(LanguageProvider, { children: element }),
  );
}

function render(
  selected: JourneyOption | null,
  liveBuses: LiveBus[] = [],
  options: JourneyOption[] = [option],
): string {
  return markup(
    createElement(JourneyResults, {
      plan: { ...plan, options },
      selected,
      liveBuses,
      onShowBus: () => {},
      loading: false,
      error: null,
      language: "en",
      onSelect: () => {},
      onRetry: () => {},
      onNextDay: () => {},
      routeColors: new Map([["CM01", "#1A5A96"]]),
    }),
  );
}

test("selecting an actual assigned-bus transfer renders its move leg instead of treating it as a ride", () => {
  assert.deepEqual(
    option.legs.map((leg) => leg.kind),
    ["ride", "move", "ride"],
  );
  const summary = render(null);
  assert.match(summary, /Change bus once/);
  assert.doesNotMatch(summary, /Get on at/);

  // Selection can arrive as a fresh equivalent payload after a query refresh.
  const selected = render(structuredClone(option));
  assert.match(selected, /aria-expanded="true"/);
  assert.equal((selected.match(/Get on at/g) ?? []).length, 2, "two rides");
  assert.equal(
    (selected.match(/>Walk</g) ?? []).length,
    1,
    "one walk between them",
  );
  assert.match(selected, /Borella 02 - YMBA/);
  assert.match(selected, /3 min/);
  assert.match(selected, /14 m/);
  assert.match(selected, /Assigned bus/);
  for (const leg of option.legs) {
    if (leg.kind === "ride" && leg.ride.bus) {
      assert.ok(selected.includes(leg.ride.bus.registration_number));
    }
  }
});

test("back-to-back rides without a walk get a change-bus step with the wait", () => {
  const [first, , second] = option.legs;
  assert.ok(first.kind === "ride" && second.kind === "ride");
  const sameStop: JourneyOption = { ...option, legs: [first, second] };
  const html = markup(
    createElement(JourneyResults, {
      plan: { ...plan, options: [sameStop] },
      selected: sameStop,
      liveBuses: [],
      onShowBus: () => {},
      loading: false,
      error: null,
      language: "en",
      onSelect: () => {},
      onRetry: () => {},
      onNextDay: () => {},
      routeColors: new Map(),
    }),
  );
  assert.match(html, /Change bus at/);
  assert.match(html, /Wait about \d+ min/);
});

test("an assigned bus running this ride now can be shown on the map", () => {
  const ride = option.legs.find((leg) => leg.kind === "ride");
  assert.ok(ride?.kind === "ride" && ride.ride.bus);
  const plate = ride.ride.bus.registration_number;
  // The live feed may format the plate differently.
  const live: LiveBus = {
    lat: 6.9,
    lng: 79.9,
    route_code: ride.ride.route.code,
    direction_id: ride.ride.direction_id,
    registration_number: plate.toLowerCase().replace(/-/g, " "),
  };
  assert.doesNotMatch(render(option), /show on map/);
  // Shift the trip so this ride boards in ten minutes.
  const shift =
    Date.now() + 10 * 60_000 - Date.parse(ride.ride.board.scheduled_time!);
  const at = (value: string) =>
    new Date(Date.parse(value) + shift).toISOString();
  const soon: JourneyOption = structuredClone(option);
  for (const leg of soon.legs) {
    if (leg.kind !== "ride") continue;
    leg.ride.board.scheduled_time = at(leg.ride.board.scheduled_time!);
    leg.ride.alight.scheduled_time = at(leg.ride.alight.scheduled_time!);
  }
  const html = render(soon, [live], [soon]);
  assert.equal((html.match(/show on map/g) ?? []).length, 1);
  assert.match(html, /Bus live/);
});

test("an assigned bus that is live elsewhere is not presented as this trip", () => {
  const ride = option.legs.find((leg) => leg.kind === "ride");
  assert.ok(ride?.kind === "ride" && ride.ride.bus);
  const base: LiveBus = {
    lat: 6.9,
    lng: 79.9,
    registration_number: ride.ride.bus.registration_number,
  };
  const cases: LiveBus[] = [
    { ...base, route_code: "CM99" },
    { ...base, route_code: ride.ride.route.code, direction_id: "other-way" },
    // Right route and direction, but the ride boards tomorrow: an earlier run.
    {
      ...base,
      route_code: ride.ride.route.code,
      direction_id: ride.ride.direction_id,
    },
  ];
  for (const bus of cases) {
    const html = render(option, [bus]);
    assert.doesNotMatch(html, /show on map/);
    assert.doesNotMatch(html, /Bus live/);
    assert.match(html, /On another trip now/);
  }
});
