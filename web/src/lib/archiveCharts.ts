import { routeColor } from "./routeColor";

export const HOURLY_SQL = `SELECT hour, route_code, moving_buses
FROM buses_per_hour
WHERE route_code IS NOT NULL
ORDER BY hour;`;

export const CROWDING_SQL = `SELECT route_code, hour, round(avg_load, 2) AS avg_load
FROM load_by_route_hour
WHERE route_code IS NOT NULL
ORDER BY route_code, hour;`;

// Mosaic's SQL builder quotes "metro.x" as one name, so the charts read local copies of the attached views.
export function chartViews(catalogUrl: string): string[] {
  return [
    `ATTACH '${catalogUrl.replaceAll("'", "''")}' AS metro (READ_ONLY)`,
    `CREATE OR REPLACE VIEW hourly AS ${HOURLY_SQL.replace(/;$/, "").replace("FROM buses_per_hour", "FROM metro.buses_per_hour")}`,
    `CREATE OR REPLACE VIEW crowding AS ${CROWDING_SQL.replace(/;$/, "").replace("FROM load_by_route_hour", "FROM metro.load_by_route_hour")}`,
  ];
}

// The catalog's route list has no colours, so they come from the site's own routes.
export function routeScale(
  routes: Iterable<{ code: string; color_hex?: string | null }>,
): { domain: string[]; range: string[] } {
  const colors = new Map<string, string>();
  for (const route of routes)
    if (!colors.has(route.code))
      colors.set(route.code, routeColor(route.color_hex ?? undefined));
  const domain = [...colors.keys()].sort();
  return { domain, range: domain.map((code) => colors.get(code)!) };
}
