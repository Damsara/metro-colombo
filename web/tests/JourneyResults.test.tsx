import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JourneyResults, {
  nextBusIndex,
  stopsAway,
} from "../src/components/JourneyResults";
import { countdown, countdownLabel, i18n } from "../src/i18n";
import { LanguageProvider } from "../src/lib/language";
import {
  colomboDate,
  type JourneyOption,
  type JourneyPlan,
  type LiveBus,
  type RouteStops,
  type Stop,
} from "../src/types";

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
// test switches it. Seed `client` to hand components cached query data.
function markup(
  element: ReactElement,
  client: QueryClient = new QueryClient(),
): string {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client,
      children: createElement(LanguageProvider, { children: element }),
    }),
  );
}

/** A copy of `source` whose first ride boards `minutes` from now, today. */
function boardingIn(source: JourneyOption, minutes: number): JourneyOption {
  const first = source.legs.find((leg) => leg.kind === "ride");
  assert.ok(first?.kind === "ride");
  const shift =
    Date.now() +
    minutes * 60_000 -
    Date.parse(first.ride.board.scheduled_time!);
  const at = (value: string) =>
    new Date(Date.parse(value) + shift).toISOString();
  const moved: JourneyOption = structuredClone(source);
  moved.departure_time = at(moved.departure_time);
  moved.arrival_time = at(moved.arrival_time);
  for (const leg of moved.legs) {
    if (leg.kind !== "ride") continue;
    leg.ride.board.scheduled_time = at(leg.ride.board.scheduled_time!);
    leg.ride.alight.scheduled_time = at(leg.ride.alight.scheduled_time!);
  }
  return moved;
}

function renderToday(
  options: JourneyOption[],
  liveBuses: LiveBus[] = [],
  client?: QueryClient,
): string {
  return markup(
    createElement(JourneyResults, {
      plan: { ...plan, date: colomboDate(), options },
      selected: null,
      liveBuses,
      onShowBus: () => {},
      loading: false,
      error: null,
      language: "en",
      onSelect: () => {},
      onRetry: () => {},
      onNextDay: () => {},
      routeColors: new Map(),
    }),
    client,
  );
}

function render(
  selected: JourneyOption | null,
  liveBuses: LiveBus[] = [],
  options: JourneyOption[] = [option],
  onTrack?: () => void,
): string {
  return markup(
    createElement(JourneyResults, {
      plan: { ...plan, options },
      selected,
      liveBuses,
      onShowBus: () => {},
      onTrack,
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
  // With tracking on offer it leads, and the plain map view stays.
  const trackable = render(soon, [live], [soon], () => {});
  assert.equal((trackable.match(/Track this bus/g) ?? []).length, 1);
  assert.match(trackable, /Show on map/);
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

test("countdowns read now, minutes, or the clock past an hour", () => {
  const now = Date.parse("2026-10-11T05:00:00+05:30");
  const at = (seconds: number) => countdown(now + seconds * 1000, now);
  assert.deepEqual(at(0), { kind: "now" });
  assert.deepEqual(at(59), { kind: "now" });
  assert.deepEqual(at(60), { kind: "in", minutes: 1 });
  // Rounded down, so nobody is told they have longer than they do.
  assert.deepEqual(at(12 * 60 + 50), { kind: "in", minutes: 12 });
  assert.deepEqual(at(59 * 60 + 59), { kind: "in", minutes: 59 });
  assert.deepEqual(at(60 * 60), { kind: "clock" });
  assert.deepEqual(at(-30), { kind: "now" });
  assert.deepEqual(at(-3 * 60 - 10), { kind: "left", minutes: 3 });

  assert.equal(countdownLabel(i18n, at(0)), "Leaves now");
  assert.equal(countdownLabel(i18n, at(60)), "Leaves in 1 min");
  assert.equal(countdownLabel(i18n, at(59 * 60)), "Leaves in 59 min");
  assert.equal(countdownLabel(i18n, at(-180)), "Left 3 min ago");
  assert.equal(countdownLabel(i18n, at(90 * 60)), null);
});

test("the soonest departure still to come today is the next bus", () => {
  const now = Date.now();
  const later = boardingIn(option, 40);
  const soon = boardingIn(option, 5);
  const gone = boardingIn(option, -2);
  assert.equal(nextBusIndex([later, gone, soon], true, now), 2);
  assert.equal(nextBusIndex([gone], true, now), -1);
  assert.equal(nextBusIndex([later, soon], false, now), -1);
});

test("today's journeys lead with a countdown and mark the next bus", () => {
  const html = renderToday([boardingIn(option, 70), boardingIn(option, 10.5)]);
  assert.match(html, /Leaves in 10 min/);
  assert.equal((html.match(/Next bus/g) ?? []).length, 1);
  // The later one is over an hour off, so it shows its clock time instead.
  assert.equal((html.match(/Leaves in/g) ?? []).length, 1);
  // Next bus sits on the soonest card, which is listed first.
  assert.ok(html.indexOf("Next bus") < html.indexOf("Leaves in 10 min"));
  assert.match(html, /Scheduled/);
  assert.match(html, /All times are Sri Lanka time/);
  assert.doesNotMatch(html, /Summary times are scheduled/);
});

test("another day's journeys show clock times without countdowns", () => {
  const html = render(null);
  assert.doesNotMatch(html, /Leaves/);
  assert.doesNotMatch(html, /Next bus/);
  assert.match(html, /5:30 AM/);
});

test("a live estimate on the first stop is labelled as one", () => {
  const live = boardingIn(option, 20);
  const first = live.legs.find((leg) => leg.kind === "ride");
  assert.ok(first?.kind === "ride");
  first.ride.board.time_status = "live";
  first.ride.board.estimated_time = new Date(
    Date.now() + 25.5 * 60_000,
  ).toISOString();
  const html = renderToday([live]);
  assert.match(html, /Live estimate/);
  assert.match(html, /Leaves in 25 min/);
});

function stopAt(id: string, latitude: number): Stop {
  return {
    id,
    stop_code: id,
    stop_name_en: id,
    stop_name_si: id,
    stop_name_tm: id,
    latitude,
    longitude: 79.9,
  };
}

// Stops about 1.1 km apart on a line heading north.
const line = ["a", "b", "c", "d", "e", "f"].map((id, index) =>
  stopAt(id, 6.8 + index * 0.01),
);

test("stops away counts the stops until the bus reaches yours", () => {
  const near = (latitude: number) => ({ lat: latitude, lng: 79.9 });
  assert.equal(stopsAway(near(6.8), line, "e"), 4);
  // Just past b, heading for c: c, d, then e.
  assert.equal(stopsAway(near(6.8115), line, "e"), 3);
  // Nearly at c.
  assert.equal(stopsAway(near(6.819), line, "e"), 3);
  // Between d and e, e is next.
  assert.equal(stopsAway(near(6.835), line, "e"), 1);
  assert.equal(stopsAway(near(6.84), line, "e"), 0);
  assert.equal(stopsAway(near(6.85), line, "e"), -1);
  assert.equal(stopsAway(near(6.8), line, "missing"), null);
});

test("a live bus on the ride shows how far off it is and how full", () => {
  const soon = boardingIn(option, 10);
  const first = soon.legs.find((leg) => leg.kind === "ride");
  assert.ok(first?.kind === "ride" && first.ride.bus);
  const ride = first.ride;
  const plate = first.ride.bus.registration_number;
  // Put the journey's boarding stop fourth on the direction's stop list.
  const stops = [...line.slice(0, 3), ride.board, ...line.slice(3)];
  const client = new QueryClient();
  client.setQueryData<RouteStops>(
    ["route-stops", ride.route.code, ride.direction_id],
    {
      route_code: ride.route.code,
      direction_id: ride.direction_id,
      direction_label: "",
      stops,
    },
  );
  const bus: LiveBus = {
    lat: line[0].latitude,
    lng: line[0].longitude,
    route_code: ride.route.code,
    direction_id: ride.direction_id,
    registration_number: plate,
    current_capacity: 10,
    total_capacity: 60,
  };
  const html = renderToday([soon], [bus], client);
  assert.match(html, /Bus live/);
  assert.match(html, /3 stops away/);
  assert.match(html, /Plenty of room/);

  // One stop out reads in the singular, and without stop data it just says live.
  const oneOut = { ...bus, lat: line[2].latitude };
  assert.match(renderToday([soon], [oneOut], client), /1 stop away/);
  const unknown = renderToday([soon], [bus]);
  assert.match(unknown, /Bus live/);
  assert.doesNotMatch(unknown, /stops? away/);
});

test("a journey with no bus assigned yet is marked on the card and in its steps", () => {
  const unassigned: JourneyOption = {
    ...option,
    legs: option.legs.map((leg) =>
      leg.kind === "ride"
        ? { ...leg, ride: { ...leg.ride, bus: undefined } }
        : leg,
    ),
  };
  const card = render(null, [], [unassigned]);
  assert.match(card, /No bus assigned yet/);
  assert.match(card, /border-dashed/);
  const steps = render(unassigned, [], [unassigned]);
  assert.match(steps, /can(&#x27;|')t be followed live/);
  assert.doesNotMatch(render(null), /No bus assigned yet/);
});
