type LngLat = readonly [number, number];

const METERS_PER_DEGREE = 111_320;
const MAX_ROAD_METERS = 80;

export function roadBearing(
  point: LngLat,
  lines: readonly (readonly LngLat[])[],
  maxMeters = MAX_ROAD_METERS,
): number | null {
  const xScale = Math.cos((point[1] * Math.PI) / 180) * METERS_PER_DEGREE;
  const local = ([lng, lat]: LngLat): [number, number] => [
    (lng - point[0]) * xScale,
    (lat - point[1]) * METERS_PER_DEGREE,
  ];
  let best: { distance: number; bearing: number } | null = null;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = local(line[i - 1]);
      const [bx, by] = local(line[i]);
      const dx = bx - ax;
      const dy = by - ay;
      const length = dx * dx + dy * dy;
      if (length === 0) continue;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
      const distance = Math.hypot(ax + t * dx, ay + t * dy);
      if (distance > maxMeters || (best && distance >= best.distance)) continue;
      const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 180;
      best = { distance, bearing };
    }
  }
  return best?.bearing ?? null;
}
