import { routeColor } from "./routeColor";

export const HOURLY_SQL = `SELECT hour, route_code, moving_buses
FROM buses_per_hour
WHERE route_code IS NOT NULL
ORDER BY hour;`;

export const CROWDING_SQL = `SELECT route_code, hour, round(avg_load, 2) AS avg_load
FROM load_by_route_hour
WHERE route_code IS NOT NULL
ORDER BY route_code, hour;`;

export function setupStatements(catalogUrl: string): string[] {
  return [
    `ATTACH '${catalogUrl.replaceAll("'", "''")}' AS metro (READ_ONLY)`,
    // Charts keep their views in memory while the queries on the page still name the archive's tables bare.
    "SET search_path = 'memory.main,metro.main'",
    chartView("hourly", HOURLY_SQL),
    chartView("crowding", CROWDING_SQL),
  ];
}

const statement = (sql: string) => sql.trim().replace(/;$/, "");

export function chartView(name: string, sql: string, extra?: string): string {
  return `CREATE OR REPLACE VIEW ${name} AS SELECT *${extra ? `, ${extra}` : ""} FROM (${statement(sql)})`;
}

export function withoutLimit(sql: string): string {
  return statement(sql).replace(/\s+LIMIT\s+\d+\s*$/i, "");
}

export function forStop(sql: string, stopCode: string): string {
  return sql.replace("'MCC5'", `'${stopCode.replaceAll("'", "''")}'`);
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
