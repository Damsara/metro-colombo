import assert from "node:assert/strict";
import { test } from "vitest";
import {
  COLOMBO_TARIFF,
  fareRange,
  lastMileEstimate,
  straightLineKm,
  type Tariff,
} from "../src/lib/pickmeFare";

const fort = { lat: 6.9335, lng: 79.85 };
const independenceSquare = { lat: 6.9061, lng: 79.8686 };
const galleFace = { lat: 6.9219, lng: 79.8451 };

const fitted: Tariff = {
  calibrated: true,
  minFare: 300,
  minKm: 1.5,
  aboveKmFare: 110,
  nightFare: 100,
  nightFrom: 22,
  nightTo: 5,
};

test("straight line matches a known Colombo pair", () => {
  const km = straightLineKm(fort, independenceSquare);
  assert.ok(Math.abs(km - 3.68) < 0.05, `got ${km}`);
});

test("the circuity band contains both measured urban ratios", () => {
  const measured = [
    { to: independenceSquare, osrmKm: 5.6 },
    { to: galleFace, osrmKm: 2.4 },
  ];
  for (const pair of measured) {
    const estimate = lastMileEstimate(fort, pair.to, 12);
    const lowRatio = pair.osrmKm / straightLineKm(fort, pair.to);
    assert.ok(
      lowRatio >= 1.4 && lowRatio <= 1.8,
      `ratio ${lowRatio.toFixed(2)} outside the band`,
    );
    assert.ok(
      estimate.km.low <= pair.osrmKm && pair.osrmKm <= estimate.km.high,
      `${pair.osrmKm} km not bracketed by ${estimate.km.low}–${estimate.km.high}`,
    );
  }
});

test("an hour outside the night window charges the day minimum", () => {
  const day = fareRange({ low: 0.4, high: 0.6 }, 12, fitted);
  assert.deepEqual(day, { low: 300, high: 300 });
});

test("the kink is priced as a minimum plus a per-km rate", () => {
  assert.deepEqual(fareRange({ low: 2, high: 2 }, 12, fitted), {
    low: 360,
    high: 360,
  });
  assert.deepEqual(fareRange({ low: 10, high: 10 }, 12, fitted), {
    low: 1240,
    high: 1240,
  });
});

test("night adds a flat surcharge on top of the distance price", () => {
  const day = fareRange({ low: 10, high: 10 }, 12, fitted);
  const night = fareRange({ low: 10, high: 10 }, 23, fitted);
  assert.equal((night?.low ?? 0) - (day?.low ?? 0), 100);
});

test("an uncalibrated tariff never produces a price", () => {
  assert.equal(fareRange({ low: 1, high: 20 }, 12, COLOMBO_TARIFF), null);
  assert.equal(lastMileEstimate(fort, galleFace, 12).fare, null);
});

test("the estimate keeps low below high and minutes above zero", () => {
  for (const to of [independenceSquare, galleFace, fort]) {
    const estimate = lastMileEstimate(fort, to, 12);
    assert.ok(estimate.km.low <= estimate.km.high);
    assert.ok(estimate.minutes.low >= 1);
    assert.ok(estimate.minutes.low <= estimate.minutes.high);
  }
});
