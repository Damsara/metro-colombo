import type { Position } from "geojson";
import {
  LAT_METERS,
  LNG_METERS,
  pathPoint,
  project,
  routePaths,
  toXY,
  type Path,
  type XY,
} from "../busMotion";
import type { MapRoute } from "../types";

export const SPLIT_MAX_METERS = 300;

export type RouteSplit = { behind: Position[][]; ahead: Position[][] };

const pathsByRoute = new WeakMap<MapRoute, Path[]>();

function pathsOf(route: MapRoute): Path[] {
  let paths = pathsByRoute.get(route);
  if (!paths) {
    paths = routePaths(route);
    pathsByRoute.set(route, paths);
  }
  return paths;
}

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

export function splitRoute(
  route: MapRoute,
  bus: { lat: number; lng: number },
): RouteSplit | null {
  const paths = pathsOf(route);
  const fix = toXY(bus);

  let best: { path: number; segment: number; fraction: number } | undefined;
  let bestError = Infinity;
  for (const [index, path] of paths.entries()) {
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
  }
  if (!best || bestError > SPLIT_MAX_METERS) return null;
  const match = best;

  const behind: Position[][] = [];
  const ahead: Position[][] = [];
  paths.forEach((path, index) => {
    const points = path.points.map(toPosition);
    if (index < match.path) behind.push(points);
    else if (index > match.path) ahead.push(points);
    else {
      const from = path.distances[match.segment - 1];
      const to = path.distances[match.segment];
      const cut = toPosition(
        pathPoint(path, from + (to - from) * match.fraction),
      );
      behind.push([...points.slice(0, match.segment), cut]);
      ahead.push([cut, ...points.slice(match.segment)]);
    }
  });
  return {
    behind: behind.map(dedupe).filter(moves),
    ahead: ahead.map(dedupe).filter(moves),
  };
}
