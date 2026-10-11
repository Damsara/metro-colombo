import type { Position } from "geojson";
import {
  LAT_METERS,
  LNG_METERS,
  buildPath,
  lines,
  project,
  type XY,
} from "../busMotion";
import type { MapRoute } from "../types";

export const SPLIT_MAX_METERS = 300;

export type RouteSplit = { behind: Position[][]; ahead: Position[][] };

const toPosition = (point: XY): Position => [
  point.x / LNG_METERS,
  point.y / LAT_METERS,
];

const dedupe = (line: Position[]) =>
  line.filter(
    (point, i) =>
      i === 0 || point[0] !== line[i - 1][0] || point[1] !== line[i - 1][1],
  );

const moves = (line: Position[]) =>
  line.some((point) => point[0] !== line[0][0] || point[1] !== line[0][1]);

/** Splits a direction's line at the spot nearest the bus; null if it is too far off. */
export function splitRoute(
  route: MapRoute,
  bus: { lat: number; lng: number },
): RouteSplit | null {
  const paths = route.geometry.features.flatMap((feature) =>
    feature.geometry
      ? lines(feature.geometry).flatMap((line) => buildPath(route, line) ?? [])
      : [],
  );
  const fix = { x: bus.lng * LNG_METERS, y: bus.lat * LAT_METERS };

  let best: { path: number; segment: number; fraction: number } | undefined;
  let bestError = Infinity;
  paths.forEach((path, index) => {
    for (let i = 1; i < path.points.length; i++) {
      const { fraction, error } = project(
        fix,
        path.points[i - 1],
        path.points[i],
      );
      if (error >= bestError) continue;
      bestError = error;
      best = { path: index, segment: i, fraction };
    }
  });
  if (!best || bestError > SPLIT_MAX_METERS) return null;

  const behind: Position[][] = [];
  const ahead: Position[][] = [];
  paths.forEach((path, index) => {
    const points = path.points.map(toPosition);
    if (index < best!.path) behind.push(points);
    else if (index > best!.path) ahead.push(points);
    else {
      const start = path.points[best!.segment - 1];
      const end = path.points[best!.segment];
      const cut = toPosition({
        x: start.x + (end.x - start.x) * best!.fraction,
        y: start.y + (end.y - start.y) * best!.fraction,
      });
      behind.push([...points.slice(0, best!.segment), cut]);
      ahead.push([cut, ...points.slice(best!.segment)]);
    }
  });
  return {
    behind: behind.map(dedupe).filter(moves),
    ahead: ahead.map(dedupe).filter(moves),
  };
}
