import type { Geometry, Position } from "geojson";
import {
  busKey,
  resolveBusDirectionId,
  type LiveBus,
  type MapRoute,
  type Route,
} from "./types";

// Positions are worked out in metres on a flat grid around Colombo, accurate enough for a city-sized network.
export const LAT_METERS = 111320;
export const LNG_METERS = LAT_METERS * Math.cos((6.9271 * Math.PI) / 180);

const MAX_SPEED = 25; // m/s (90 km/h). Faster is GPS noise, even on Galle Road.

// Between fixes a bus keeps going at its last speed for a while, then slows
// to a stop.
const PREDICT_SECONDS = 30;
const COAST_SECONDS = 10;
const SPEED_CHANGE_SECONDS = 1.2;
const MIN_FIX_GAP_SECONDS = 0.2;

// A fix joins a route line within ACQUIRE_METERS of it, and may drift up to
// RETAIN_METERS before it lets go.
const ACQUIRE_METERS = 25;
const RETAIN_METERS = 45;
// Scoring candidate spots on the route lines (lower wins): metres off the line,
// plus a penalty per degree off the bus's course, minus a bonus for staying on
// the line it's already on.
const HEADING_PENALTY_PER_DEGREE = 1 / 4;
const STAY_ON_PATH_BONUS = 10;
// Extra room, beyond MAX_SPEED, for how far a bus could have moved since.
const REACH_SLACK_METERS = 50;

// Moves smaller than this are GPS wobble, not travel.
const GPS_DEADBAND = 8;
// A fix this far behind the last one on the same line is noise, not reversing.
const BACKSLIDE_METERS = 20;

// When a fix disagrees with the prediction, the difference is blended out
// over a few seconds rather than snapped.
const MIN_CORRECTION_SECONDS = 2;
const MAX_FIX_GAP_FOR_CORRECTION_SECONDS = 10;
const CORRECTION_SPEED_SHARE = 0.7;

const LOOK_BEHIND_METERS = 4;
const LOOK_AHEAD_METERS = 8;
const LOOP_GAP_METERS = 20;
const MIN_STEP_METERS = 0.01;
const HEADING_SMOOTHING_SECONDS = 0.18;
// Feed timestamps below this are in seconds rather than milliseconds.
const SECONDS_TIMESTAMP_LIMIT = 1e11;

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
const angleDelta = (from: number, to: number) =>
  ((to - from + 540) % 360) - 180;
// Compass bearing in degrees (0 = north, clockwise) of a step east dx, north dy.
const bearing = (dx: number, dy: number) =>
  ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

export type XY = { x: number; y: number };

export type Path = {
  key: string;
  code: string;
  direction?: string;
  points: XY[];
  distances: number[];
  length: number;
  loop: boolean;
};

type Match = { path: Path; distance: number; error: number; heading: number };

type Track = {
  source: LiveBus;
  path?: Path;

  fixX: number;
  fixY: number;
  /** Distance along `path` that the prediction starts from. */
  fixDistance: number;
  /** Distance along `path` as measured, for speed and jitter checks. */
  observedDistance: number;

  x: number;
  y: number;
  /** Distance along `path`; it never goes backwards. */
  distance: number;
  heading: number;

  speed: number;
  /** The speed before this fix, eased out as `speed` takes over. */
  startSpeed: number;
  course: number;
  /** Whether to turn towards the course or the line, or hold the heading. */
  steer: boolean;

  correction: number;
  correctionX: number;
  correctionY: number;
  correctionTime: number;

  at: number;
  observedAt: number;
  frameAt: number;
  fixTime?: number;
  /** The newest timestamp seen, including fixes that were rejected. */
  lastTimestamp?: number;
};

export function toXY(bus: Pick<LiveBus, "lat" | "lng">): XY {
  return { x: bus.lng * LNG_METERS, y: bus.lat * LAT_METERS };
}

function lines(geometry: Geometry): Position[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.flatMap(lines);
  return [];
}

function buildPath(route: MapRoute, line: Position[]): Path | undefined {
  const points: XY[] = [];
  const distances: number[] = [];
  let length = 0;
  for (const [lng, lat] of line) {
    const point = { x: lng * LNG_METERS, y: lat * LAT_METERS };
    const previous = points.at(-1);
    const step = previous
      ? Math.hypot(point.x - previous.x, point.y - previous.y)
      : 0;
    if (previous && step < MIN_STEP_METERS) continue;
    length += step;
    points.push(point);
    distances.push(length);
  }
  if (points.length < 2) return undefined;

  const first = points[0];
  const last = points[points.length - 1];
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  const loop = gap < LOOP_GAP_METERS;
  if (loop && gap > MIN_STEP_METERS) {
    length += gap;
    points.push(first);
    distances.push(length);
  }
  return {
    key: `${route.code}:${route.directionId}:${first.x}:${first.y}:${length}`,
    code: route.code,
    direction: route.directionId,
    points,
    distances,
    length,
    loop,
  };
}

export function routePaths(route: MapRoute): Path[] {
  return route.geometry.features.flatMap((feature) =>
    feature.geometry
      ? lines(feature.geometry).flatMap((line) => buildPath(route, line) ?? [])
      : [],
  );
}

export function pathPoint(path: Path, distance: number): XY {
  const along = path.loop
    ? ((distance % path.length) + path.length) % path.length
    : clamp(distance, 0, path.length);
  let low = 0;
  let high = path.distances.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (path.distances[mid] <= along) low = mid;
    else high = mid;
  }
  const start = path.points[low];
  const end = path.points[high];
  const fraction =
    (along - path.distances[low]) /
    (path.distances[high] - path.distances[low]);
  return {
    x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction,
  };
}

function pathHeading(path: Path, distance: number, sign: number): number {
  const behind = pathPoint(path, distance - sign * LOOK_BEHIND_METERS);
  const ahead = pathPoint(path, distance + sign * LOOK_AHEAD_METERS);
  return bearing(ahead.x - behind.x, ahead.y - behind.y);
}

export function project(point: XY, start: XY, end: XY) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fraction = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
    0,
    1,
  );
  const error = Math.hypot(
    point.x - start.x - dx * fraction,
    point.y - start.y - dy * fraction,
  );
  return { fraction, error };
}

// On a loop, pick the lap closest to where the bus was, so passing the start
// of the line isn't mistaken for a jump back.
function nearestLap(path: Path, distance: number, near: number): number {
  if (!path.loop) return distance;
  return distance + Math.round((near - distance) / path.length) * path.length;
}

function fixTime(bus: LiveBus): number | undefined {
  if (!bus.timestamp) return undefined;
  return bus.timestamp < SECONDS_TIMESTAMP_LIMIT
    ? bus.timestamp * 1000
    : bus.timestamp;
}

function secondsSince(
  previous: Track,
  stamp: number | undefined,
  now: number,
): number {
  const elapsedMs =
    stamp !== undefined && previous.fixTime !== undefined
      ? stamp - previous.fixTime
      : now - previous.observedAt;
  return Math.max(MIN_FIX_GAP_SECONDS, elapsedMs / 1000);
}

function isOlderFix(previous: Track, stamp: number | undefined): boolean {
  return (
    stamp !== undefined &&
    previous.lastTimestamp !== undefined &&
    stamp <= previous.lastTimestamp
  );
}

function isRepeatedFix(
  previous: Track,
  bus: LiveBus,
  stamp: number | undefined,
): boolean {
  return (
    stamp === previous.lastTimestamp &&
    bus.lat === previous.source.lat &&
    bus.lng === previous.source.lng &&
    bus.direction_id === previous.source.direction_id &&
    bus.route_code === previous.source.route_code
  );
}

// A bus waiting at a stop keeps facing the same way; GPS wobble isn't a turn.
function holdStill(
  track: Track,
  bus: LiveBus,
  now: number,
  stamp: number | undefined,
): void {
  track.source = bus;
  track.startSpeed = track.speed;
  track.speed = 0;
  track.fixDistance = track.distance;
  track.correction = 0;
  track.correctionX = track.path ? 0 : track.x - track.fixX;
  track.correctionY = track.path ? 0 : track.y - track.fixY;
  track.at = now;
  track.steer = false;
  track.lastTimestamp = stamp;
}

// How long to take blending out a correction: at least a couple of seconds,
// up to the gap between fixes, and longer for a big correction at low speed.
function correctionSeconds(
  fixGap: number,
  correction: number,
  speed: number,
): number {
  return Math.max(
    MIN_CORRECTION_SECONDS,
    Math.min(fixGap, MAX_FIX_GAP_FOR_CORRECTION_SECONDS),
    Math.abs(correction) / Math.max(speed * CORRECTION_SPEED_SHARE, 1),
  );
}

// Move by velocity, not by jumping between fixes: keep going at the observed
// speed, then coast to a stop if the feed goes quiet, rather than sending the
// bus off on a trip nobody reported.
function travel(track: Track, elapsed: number): number {
  const predicting = Math.min(elapsed, PREDICT_SECONDS);
  const easedIn =
    track.speed * predicting +
    (track.startSpeed - track.speed) *
      SPEED_CHANGE_SECONDS *
      (1 - Math.exp(-predicting / SPEED_CHANGE_SECONDS));
  const coasting = clamp(elapsed - PREDICT_SECONDS, 0, COAST_SECONDS);
  const coasted =
    track.speed * (coasting - (coasting * coasting) / (2 * COAST_SECONDS));
  return easedIn + coasted;
}

// How much of the last correction is still left to blend out, from 1 down to 0.
// On a route it decays smoothly; off-route it eases out over correctionTime.
function correctionLeft(track: Track, elapsed: number): number {
  if (track.path)
    return Math.exp(
      -Math.min(elapsed, PREDICT_SECONDS + COAST_SECONDS) /
        track.correctionTime,
    );
  const progress = clamp(elapsed / track.correctionTime, 0, 1);
  return 1 - progress * progress * (3 - 2 * progress);
}

export class BusMotion {
  private paths: Path[] = [];
  private geometries?: MapRoute[];
  private routes: Route[] = [];
  private rematch = false;
  private readonly tracks = new Map<string, Track>();

  setRoutes(geometries: MapRoute[], routes: Route[]): void {
    this.routes = routes;
    if (this.geometries === geometries) return;
    this.geometries = geometries;
    this.rematch = true;
    this.paths = geometries.flatMap(routePaths);
  }

  update(buses: LiveBus[], now: number): void {
    const present = new Set<string>();
    for (const bus of buses) {
      const key = busKey(bus);
      if (!key) continue;
      present.add(key);
      const track = this.nextTrack(this.tracks.get(key), bus, now);
      if (track) this.tracks.set(key, track);
    }
    for (const key of this.tracks.keys())
      if (!present.has(key)) this.tracks.delete(key);
    this.rematch = false;
  }

  sample(now: number, reducedMotion = false): LiveBus[] {
    const result: LiveBus[] = [];
    for (const track of this.tracks.values()) {
      const elapsed = Math.max(0, (now - track.at) / 1000);
      const displacement = reducedMotion ? 0 : travel(track, elapsed);
      const correction = reducedMotion ? 0 : correctionLeft(track, elapsed);
      let desiredHeading = track.steer ? track.course : track.heading;
      if (track.path) {
        const predicted =
          track.fixDistance + displacement + track.correction * correction;
        track.distance = reducedMotion
          ? track.fixDistance
          : Math.max(track.distance, predicted);
        const point = pathPoint(track.path, track.distance);
        track.x = point.x + track.correctionX * correction;
        track.y = point.y + track.correctionY * correction;
        if (track.steer)
          desiredHeading = pathHeading(track.path, track.distance, 1);
      } else {
        // Off-route (a detour, or a driver who knows a shortcut): ease toward
        // the real GPS and don't guess at a road.
        track.x = track.fixX + track.correctionX * correction;
        track.y = track.fixY + track.correctionY * correction;
      }
      this.turn(track, desiredHeading, now, reducedMotion);
      result.push({
        ...track.source,
        lat: track.y / LAT_METERS,
        lng: track.x / LNG_METERS,
        heading: (track.heading + 360) % 360,
      });
    }
    return result;
  }

  private nextTrack(
    previous: Track | undefined,
    bus: LiveBus,
    now: number,
  ): Track | undefined {
    const stamp = fixTime(bus);
    if (previous && !this.rematch) {
      if (isOlderFix(previous, stamp)) return undefined;
      // Repeated fixes don't restart the optimistic prediction clock.
      if (isRepeatedFix(previous, bus, stamp)) {
        previous.source = bus;
        return undefined;
      }
    }

    const fix = toXY(bus);
    const movement = previous
      ? Math.hypot(fix.x - previous.fixX, fix.y - previous.fixY)
      : 0;
    const fixGap = previous ? secondsSince(previous, stamp, now) : 1;
    const measuredCourse =
      previous && movement >= GPS_DEADBAND
        ? bearing(fix.x - previous.fixX, fix.y - previous.fixY)
        : (previous?.heading ?? bus.heading);
    // A single impossible fix shouldn't teleport the bus across town or spin it.
    if (previous && movement / fixGap > MAX_SPEED) {
      previous.lastTimestamp = stamp;
      return undefined;
    }

    const candidate = this.match(bus, previous, now, measuredCourse);
    const samePath = candidate && previous?.path?.key === candidate.path.key;
    const slidBack =
      previous &&
      candidate &&
      samePath &&
      candidate.distance < previous.observedDistance;
    const unchangedAssignment =
      previous &&
      previous.source.route_code === bus.route_code &&
      previous.source.direction_id === bus.direction_id;
    const jitter =
      previous &&
      unchangedAssignment &&
      (movement < GPS_DEADBAND ||
        (slidBack &&
          previous.observedDistance - candidate.distance < BACKSLIDE_METERS));
    if (jitter && !this.rematch) {
      holdStill(previous, bus, now, stamp);
      return undefined;
    }
    // Sliding back further than wobble doesn't fit the line at all.
    const matched = slidBack ? undefined : candidate;

    const continuing = matched && previous?.path?.key === matched.path.key;
    const measuredSpeed =
      matched && continuing
        ? (matched.distance - previous.observedDistance) / fixGap
        : movement / fixGap;
    const speed = matched ? clamp(measuredSpeed, 0, MAX_SPEED) : 0;
    const anchor = matched ? pathPoint(matched.path, matched.distance) : fix;
    const correction =
      matched && continuing ? previous.distance - matched.distance : 0;
    return {
      source: bus,
      path: matched?.path,
      fixX: fix.x,
      fixY: fix.y,
      fixDistance: matched?.distance ?? 0,
      observedDistance: matched?.distance ?? 0,
      x: previous?.x ?? anchor.x,
      y: previous?.y ?? anchor.y,
      distance: continuing ? previous.distance : (matched?.distance ?? 0),
      heading: previous?.heading ?? matched?.heading ?? bus.heading ?? 0,
      speed,
      startSpeed: continuing ? previous.speed : speed,
      course: measuredCourse ?? previous?.heading ?? 0,
      steer: movement >= GPS_DEADBAND || !previous,
      correction,
      correctionX: continuing ? 0 : (previous?.x ?? anchor.x) - anchor.x,
      correctionY: continuing ? 0 : (previous?.y ?? anchor.y) - anchor.y,
      correctionTime: correctionSeconds(fixGap, correction, speed),
      at: now,
      observedAt: now,
      frameAt: previous?.frameAt ?? now,
      fixTime: stamp,
      lastTimestamp: stamp,
    };
  }

  // The direction to search: a direction id, `undefined` to try both, or
  // `null` when the feed names a direction this route doesn't have.
  private directionFor(bus: LiveBus): string | undefined | null {
    const raw = bus.direction_id;
    if (!raw) return undefined;
    const route = this.routes.find((item) => item.code === bus.route_code);
    const known =
      route?.directions.some((item) => item.id === raw) ||
      /^(forward|reverse|0|1)$/i.test(raw);
    if (!known) return null;
    return resolveBusDirectionId(route, raw);
  }

  private match(
    bus: LiveBus,
    previous: Track | undefined,
    now: number,
    course: number | undefined,
  ): Match | undefined {
    const direction = this.directionFor(bus);
    if (direction === null) return undefined;
    const fix = toXY(bus);
    let best: Match | undefined;
    let bestScore = Infinity;
    for (const path of this.paths) {
      if (path.code !== bus.route_code) continue;
      if (direction && path.direction !== direction) continue;
      const retaining = previous?.path?.key === path.key;
      const maxError = retaining ? RETAIN_METERS : ACQUIRE_METERS;
      for (let i = 1; i < path.points.length; i++) {
        const start = path.points[i - 1];
        const end = path.points[i];
        const { fraction, error } = project(fix, start, end);
        if (error > maxError) continue;
        let distance =
          path.distances[i - 1] +
          fraction * (path.distances[i] - path.distances[i - 1]);
        const heading = bearing(end.x - start.x, end.y - start.y);
        let score = error;
        if (course !== undefined)
          score +=
            Math.abs(angleDelta(course, heading)) * HEADING_PENALTY_PER_DEGREE;
        if (retaining) {
          distance = nearestLap(path, distance, previous.distance);
          // Avoid hopping to the other branch at route crossings or doubled-back roads.
          const reachable =
            MAX_SPEED * Math.max(1, (now - previous.at) / 1000) +
            REACH_SLACK_METERS;
          score += Math.max(
            0,
            Math.abs(distance - previous.distance) - reachable,
          );
          score -= STAY_ON_PATH_BONUS;
        }
        if (score >= bestScore) continue;
        bestScore = score;
        best = { path, distance, error, heading };
      }
    }
    return best;
  }

  private turn(
    track: Track,
    desiredHeading: number,
    now: number,
    reducedMotion: boolean,
  ): void {
    const sinceLastFrame = Math.max(0, (now - track.frameAt) / 1000);
    const share = reducedMotion
      ? 1
      : 1 - Math.exp(-sinceLastFrame / HEADING_SMOOTHING_SECONDS);
    track.heading += angleDelta(track.heading, desiredHeading) * share;
    track.frameAt = now;
  }
}
