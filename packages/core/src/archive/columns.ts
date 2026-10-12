export const ARCHIVE_COLUMNS = [
  ["bus_id", "VARCHAR"],
  ["registration", "VARCHAR"],
  ["route_id", "VARCHAR"],
  ["route_code", "VARCHAR"],
  ["direction_id", "VARCHAR"],
  ["lat", "DOUBLE"],
  ["lng", "DOUBLE"],
  ["heading", "DOUBLE"],
  ["passengers", "INTEGER"],
  ["capacity", "INTEGER"],
  ["reported_at", "BIGINT"],
  ["received_at", "BIGINT"],
] as const satisfies ReadonlyArray<readonly [string, string]>;
