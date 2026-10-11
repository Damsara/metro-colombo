import assert from "node:assert/strict";
import { test } from "vitest";
import {
  OVERVIEW_PITCH,
  STREET_PITCH,
  canShowBuildings,
  parseMapMode,
  pitchForZoom,
  zoomBand,
} from "../src/lib/mapCamera";

test("the city overview sits at the low tilt, street level at the steep one", () => {
  assert.equal(pitchForZoom(8), OVERVIEW_PITCH);
  assert.equal(pitchForZoom(12), OVERVIEW_PITCH);
  assert.equal(pitchForZoom(15), STREET_PITCH);
  assert.equal(pitchForZoom(19), STREET_PITCH);
});

test("the tilt eases between the bands without overshooting", () => {
  assert.equal(pitchForZoom(13.5), (OVERVIEW_PITCH + STREET_PITCH) / 2);
  let previous = pitchForZoom(12);
  for (let zoom = 12.1; zoom <= 15; zoom += 0.1) {
    const pitch = pitchForZoom(zoom);
    assert.ok(pitch >= previous, `pitch drops at zoom ${zoom}`);
    assert.ok(pitch > OVERVIEW_PITCH && pitch <= STREET_PITCH);
    previous = pitch;
  }
  assert.ok(pitchForZoom(12.05) - OVERVIEW_PITCH < 0.1);
  assert.ok(STREET_PITCH - pitchForZoom(14.95) < 0.1);
});

test("zoom bands split at the overview and street zooms", () => {
  assert.equal(zoomBand(10), 0);
  assert.equal(zoomBand(12), 0);
  assert.equal(zoomBand(12.01), 1);
  assert.equal(zoomBand(14.99), 1);
  assert.equal(zoomBand(15), 2);
  assert.equal(zoomBand(18), 2);
});

test("buildings need WebGL2", () => {
  assert.equal(canShowBuildings({ webgl2: true }), true);
  assert.equal(canShowBuildings({ webgl2: false }), false);
  assert.equal(canShowBuildings({ webgl2: false, deviceMemory: 8 }), false);
});

test("Save-Data turns buildings off", () => {
  assert.equal(canShowBuildings({ webgl2: true, saveData: true }), false);
  assert.equal(canShowBuildings({ webgl2: true, saveData: false }), true);
});

test("low device memory turns buildings off; unknown memory is fine", () => {
  assert.equal(canShowBuildings({ webgl2: true, deviceMemory: 0.5 }), false);
  assert.equal(canShowBuildings({ webgl2: true, deviceMemory: 2 }), false);
  assert.equal(canShowBuildings({ webgl2: true, deviceMemory: 4 }), true);
  assert.equal(canShowBuildings({ webgl2: true, deviceMemory: 8 }), true);
  assert.equal(
    canShowBuildings({ webgl2: true, deviceMemory: undefined }),
    true,
  );
  assert.equal(canShowBuildings({ webgl2: true, deviceMemory: NaN }), true);
});

test("a stored map mode is read back, anything else is ignored", () => {
  assert.equal(parseMapMode("2d"), "2d");
  assert.equal(parseMapMode("3d"), "3d");
  for (const garbage of [
    null,
    undefined,
    "",
    "3D",
    " 2d",
    "flat",
    "true",
    '"3d"',
    3,
    {},
  ])
    assert.equal(parseMapMode(garbage), null, String(garbage));
});
