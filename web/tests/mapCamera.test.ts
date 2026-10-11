import assert from "node:assert/strict";
import { test } from "vitest";
import {
  OVERVIEW_PITCH,
  STREET_PITCH,
  canShowBuildings,
  initialTilt,
  parseMapMode,
  pitchForZoom,
  tiltFor,
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

test("the zoom-led tilt drives every camera update in 3D", () => {
  const state = initialTilt("3d");
  assert.equal(tiltFor(state, 11, 0), OVERVIEW_PITCH);
  assert.equal(tiltFor(state, 16, 10), STREET_PITCH);
});

test("2D keeps the map flat", () => {
  const state = initialTilt("2d");
  assert.equal(tiltFor(state, 16, 30), 0);
  state.manualBand = 2;
  assert.equal(tiltFor(state, 16, 30), 0);
});

test("the app's own pitch animations are left alone", () => {
  const state = { ...initialTilt("3d"), directed: true };
  assert.equal(tiltFor(state, 16, 12), undefined);
  state.mode = "2d";
  assert.equal(tiltFor(state, 16, 12), undefined);
});

test("a hand-set tilt holds inside its zoom band", () => {
  const state = { ...initialTilt("3d"), manualBand: 1 as const };
  assert.equal(tiltFor(state, 13, 60), undefined);
  assert.equal(tiltFor(state, 14.9, 60), undefined);
  assert.equal(state.manualBand, 1);
});

test("leaving the band blends the hand-set tilt back over half a zoom level", () => {
  const state = { ...initialTilt("3d"), manualBand: 1 as const };
  assert.equal(tiltFor(state, 15, 10), 10);
  assert.equal(state.manualBand, null);
  assert.equal(tiltFor(state, 15.25, 10), 10 + (STREET_PITCH - 10) / 2);
  assert.equal(tiltFor(state, 15.1, 99), 10 + (STREET_PITCH - 10) / 2);
  assert.equal(tiltFor(state, 15.5, 99), STREET_PITCH);
  assert.equal(state.blend, null);
  assert.equal(tiltFor(state, 15.1, 99), STREET_PITCH);
});

test("with reduced motion the tilt is held during a move", () => {
  const state = { ...initialTilt("3d"), reducedMotion: true };
  assert.equal(tiltFor(state, 16, 25), undefined);
  state.manualBand = 0;
  assert.equal(tiltFor(state, 16, 40), undefined);
  assert.equal(state.manualBand, null);
});

test("driver view keeps its own tilt, even in flat mode", () => {
  for (const mode of ["3d", "2d"] as const) {
    const state = { ...initialTilt(mode), chase: true };
    assert.equal(tiltFor(state, 20, 72), undefined);
  }
});
