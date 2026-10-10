import assert from "node:assert/strict";
import { test } from "vitest";
import {
  advancePhase,
  busPosition,
  isLost,
  lastSeenAt,
  liveMinutes,
  LOST_AFTER_MS,
  nextLastSeen,
  progressRows,
  refreshedRide,
  rideIndexes,
  stopsUntil,
  trackedFix,
  trackingPhase,
} from "../src/lib/tracking";
import type { JourneyPlan, Leg, LiveBus, Ride, Stop } from "../src/types";

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
const line = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id, index) =>
  stopAt(id, 6.8 + index * 0.01),
);
const near = (latitude: number) => ({ lat: latitude, lng: 79.9 });

test("the bus sits on a stop or between two, in half steps", () => {
  assert.equal(busPosition(near(6.8), line), 0);
  // GPS a little off the stop still counts as there.
  assert.equal(busPosition(near(6.8102), line), 1);
  // Just past b, heading for c.
  assert.equal(busPosition(near(6.8115), line), 1.5);
  // Nearly at c, coming from b.
  assert.equal(busPosition(near(6.819), line), 1.5);
  assert.equal(busPosition(near(6.8), []), null);
});

test("stops until counts the target, and goes negative once past it", () => {
  assert.equal(stopsUntil(0, 4), 4);
  assert.equal(stopsUntil(3.5, 4), 1);
  assert.equal(stopsUntil(4, 4), 0);
  assert.equal(stopsUntil(4.5, 4), -1);
  assert.equal(stopsUntil(5, 4), -1);
});

test("phases follow the bus from coming to arriving", () => {
  assert.equal(trackingPhase(null, null), "waiting");
  assert.equal(trackingPhase(4, 9), "approaching");
  assert.equal(trackingPhase(3, 8), "approaching");
  // Head out at two stops, one stop, and while the bus is there.
  assert.equal(trackingPhase(2, 7), "headOut");
  assert.equal(trackingPhase(1, 6), "headOut");
  assert.equal(trackingPhase(0, 5), "headOut");
  // Past the boarding stop, you're on it.
  assert.equal(trackingPhase(-1, 4), "riding");
  assert.equal(trackingPhase(-1, 2), "riding");
  assert.equal(trackingPhase(-1, null), "riding");
  assert.equal(trackingPhase(-3, 1), "nextStop");
  assert.equal(trackingPhase(-4, 0), "arrived");
  assert.equal(trackingPhase(-5, -1), "arrived");
});

test("phases never step back", () => {
  assert.equal(advancePhase("waiting", "approaching"), "approaching");
  assert.equal(advancePhase("headOut", "approaching"), "headOut");
  assert.equal(advancePhase("nextStop", "riding"), "nextStop");
  assert.equal(advancePhase("arrived", "waiting"), "arrived");
  assert.equal(advancePhase("riding", "arrived"), "arrived");
});

test("a bus is lost after a minute out of the feed", () => {
  assert.equal(isLost(0, LOST_AFTER_MS), false);
  assert.equal(isLost(0, LOST_AFTER_MS + 1), true);
});

test("live minutes come only from a live estimate still ahead", () => {
  const now = Date.parse("2026-10-11T08:00:00Z");
  const stop = line[0];
  const inSix = new Date(now + 6 * 60_000).toISOString();
  assert.equal(
    liveMinutes({ ...stop, time_status: "live", estimated_time: inSix }, now),
    6,
  );
  assert.equal(
    liveMinutes(
      { ...stop, time_status: "scheduled", estimated_time: inSix },
      now,
    ),
    null,
  );
  assert.equal(liveMinutes({ ...stop, time_status: "live" }, now), null);
  const gone = new Date(now - 60_000).toISOString();
  assert.equal(
    liveMinutes({ ...stop, time_status: "live", estimated_time: gone }, now),
    null,
  );
});

test("the progress line runs from the bus to the stop", () => {
  const ids = (rows: ReturnType<typeof progressRows>) =>
    rows.map((row) =>
      row.kind === "stop"
        ? `${row.stop.id}${row.bus ? "*" : ""}${row.target ? "!" : ""}`
        : row.kind === "bus"
          ? "bus"
          : `+${row.count}`,
    );
  assert.deepEqual(ids(progressRows(line, 1, 3)), ["b*", "c", "d!"]);
  assert.deepEqual(ids(progressRows(line, 1.5, 3)), ["bus", "c", "d!"]);
  assert.deepEqual(ids(progressRows(line, 3, 3)), ["d*!"]);
  // Long runs fold the middle.
  assert.deepEqual(ids(progressRows(line, 0, 7)), ["a*", "b", "+4", "g", "h!"]);
  assert.deepEqual(progressRows(line, 4, 3), []);
});

test("progress rows carry their place on the line, so a repeated stop keys apart", () => {
  const loop = [line[0], line[1], line[2], line[0]];
  const rows = progressRows(loop, 0, 3);
  assert.deepEqual(
    rows.map((row) => (row.kind === "stop" ? row.index : row.kind)),
    [0, 1, 2, 3],
  );
});

test("on a loop, you get off at the visit after you board", () => {
  // a b c d a: board at b, get off at a on the way round.
  const loop = [...line.slice(0, 4), line[0]];
  assert.deepEqual(rideIndexes(loop, "b", "a"), { board: 1, alight: 4 });
  assert.deepEqual(rideIndexes(line, "b", "e"), { board: 1, alight: 4 });
  assert.deepEqual(rideIndexes(line, "missing", "c"), { board: -1, alight: 2 });
  assert.deepEqual(rideIndexes(line, "e", "b"), { board: 4, alight: -1 });
});

test("a bus out of the feed stays at its last fix, not where tracking began", () => {
  const start = { lat: 1, lng: 1 };
  const last = { lat: 2, lng: 2 };
  const now = { lat: 3, lng: 3 };
  assert.equal(trackedFix(now, last, start), now);
  assert.equal(trackedFix(undefined, last, start), last);
  assert.equal(trackedFix(undefined, null, start), start);
});

test("last seen is the fix's time, measured on the feed's own clock", () => {
  // This device's clock, and the server's, an hour apart.
  const received = 1_791_660_000_000;
  const feed = received + 3_600_000;
  // The fix is 20 s older than the feed, whatever this device's clock says.
  assert.equal(
    lastSeenAt({ timestamp: feed - 20_000 }, received, feed),
    received - 20_000,
  );
  // Seconds work as well as milliseconds.
  assert.equal(
    lastSeenAt({ timestamp: feed / 1000 - 20 }, received, feed / 1000),
    received - 20_000,
  );
  // A fix stamped after the feed doesn't count as from the future.
  assert.equal(lastSeenAt({ timestamp: feed + 100 }, received, feed), received);
  // Without a feed time, this device's clock is the reference.
  assert.equal(
    lastSeenAt({ timestamp: received - 5_000 }, received),
    received - 5_000,
  );
  // Without a fix time, receiving it is all we know.
  assert.equal(lastSeenAt({}, received, feed), received);
});

test("a frozen fix runs out; a bus that leaves the feed gets the full grace", () => {
  const fix = 1_791_660_000_000;
  // Feeds keep arriving with the same fix while the server clock moves on.
  let seen = 0;
  for (let second = 0; second <= 70; second += 5) {
    const received = fix + second * 1000;
    seen = nextLastSeen(seen, { timestamp: fix }, received, received);
  }
  assert.equal(seen, fix);
  assert.equal(isLost(seen, fix + 70_000), true);

  // A fresh fix, then the bus drops out: lost only a minute after that fix.
  seen = nextLastSeen(0, { timestamp: fix }, fix, fix);
  seen = nextLastSeen(seen, undefined, fix + 5_000, fix + 5_000);
  assert.equal(seen, fix);
  assert.equal(isLost(seen, fix + 59_000), false);
  assert.equal(isLost(seen, fix + LOST_AFTER_MS + 1), true);
  // Last seen never moves back.
  assert.equal(nextLastSeen(fix, { timestamp: fix - 30_000 }, fix, fix), fix);
});

function ride(overrides: Partial<Ride> = {}): Ride {
  return {
    route: { code: "CM01", name: "" },
    direction_id: "d1",
    slot_id: "s1",
    end_location: "Colombo",
    bus: { id: "b1", registration_number: "WP-NE-6544" },
    board: { ...line[1], scheduled_time: "2026-10-11T08:00:00Z" },
    alight: { ...line[4], scheduled_time: "2026-10-11T08:30:00Z" },
    ...overrides,
  };
}
function planOf(...rides: Ride[]): JourneyPlan {
  return {
    from_stop: line[1],
    to_stop: line[4],
    date: "2026-10-11",
    queried_at: "",
    is_now: true,
    options: rides.map((item) => ({
      departure_time: item.board.scheduled_time!,
      arrival_time: item.alight.scheduled_time!,
      total_minutes: 30,
      rides: 1,
      transfers: 0,
      total_fare: { full_amount: 0, half_amount: 0, complete: true },
      legs: [{ kind: "ride", ride: item } as Leg],
    })),
  };
}
const tracked: LiveBus = {
  id: "b1",
  lat: 0,
  lng: 0,
  registration_number: "WP-NE-6544",
};

test("a refreshed plan finds the ride despite new estimates or times", () => {
  const original = ride();
  const fresh = ride({
    board: {
      ...original.board,
      estimated_time: "2026-10-11T08:04:00Z",
      time_status: "live",
    },
  });
  const other = ride({ slot_id: "s2" });
  assert.equal(refreshedRide(planOf(other, fresh), original, tracked), fresh);
  // Nothing matching keeps the ride as it was.
  assert.equal(refreshedRide(planOf(other), original, tracked), original);
  assert.equal(refreshedRide(undefined, original, tracked), original);
  // A different alighting stop is a different ride.
  const elsewhere = ride({ alight: { ...line[5] } });
  assert.equal(refreshedRide(planOf(elsewhere), original, tracked), original);
});

test("without a slot, the tracked bus's ride wins, then the closest departure", () => {
  const original = ride({ slot_id: undefined });
  const later = ride({
    slot_id: undefined,
    bus: { id: "b9", registration_number: "WP-NE-9999" },
    board: { ...line[1], scheduled_time: "2026-10-11T08:20:00Z" },
  });
  const swapped = ride({
    slot_id: undefined,
    bus: { id: "b2", registration_number: "WP-NE-1111" },
    board: { ...line[1], scheduled_time: "2026-10-11T08:01:00Z" },
  });
  const mine = ride({
    slot_id: undefined,
    board: { ...line[1], scheduled_time: "2026-10-11T08:40:00Z" },
  });
  assert.equal(
    refreshedRide(planOf(later, swapped, mine), original, tracked),
    mine,
  );
  // Reassigned to another bus: the departure nearest the original.
  assert.equal(
    refreshedRide(planOf(later, swapped), original, tracked),
    swapped,
  );
});
