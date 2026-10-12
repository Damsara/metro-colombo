import { decompress } from "fzstd";
import { parquetMetadata, parquetReadObjects } from "hyparquet";
import { type ArchiveRow, colomboDay, optional } from "@metro/core";
import { colomboDayStart } from "@metro/upstream";

const compressors = {
  ZSTD: (input: Uint8Array, outputLength: number) =>
    decompress(input, new Uint8Array(outputLength)),
};

const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const number = (value: unknown) =>
  typeof value === "bigint"
    ? Number(value)
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
export const replaySources = (day: string) => [
  `fixes/date=${day}/fixes.parquet`,
  ...Array.from(
    { length: 23 },
    (_, index) =>
      `today/date=${day}/through=${String(23 - index).padStart(2, "0")}.parquet`,
  ),
];

export function fromParquetRow(
  row: Record<string, unknown>,
): ArchiveRow | undefined {
  const bus_id = text(row.bus_id);
  const lat = number(row.lat);
  const lng = number(row.lng);
  const received_at = number(row.received_at);
  if (
    !bus_id ||
    lat === undefined ||
    lng === undefined ||
    received_at === undefined
  )
    return undefined;
  return {
    bus_id,
    ...optional("registration", text(row.registration)),
    ...optional("route_id", text(row.route_id)),
    ...optional("route_code", text(row.route_code)),
    ...optional("direction_id", text(row.direction_id)),
    lat,
    lng,
    ...optional("heading", number(row.heading)),
    ...optional("passengers", number(row.passengers)),
    ...optional("capacity", number(row.capacity)),
    ...optional("reported_at", number(row.reported_at)),
    received_at,
  };
}

export async function hoursFromParquet(
  file: ArrayBuffer,
  day: string,
): Promise<Map<number, ArchiveRow[]>> {
  const metadata = parquetMetadata(file);
  const rows = (await parquetReadObjects({ file, metadata, compressors }))
    .flatMap((row) => {
      const archived = fromParquetRow(row);
      return archived ? [archived] : [];
    })
    .sort((a, b) => a.received_at - b.received_at);
  const dayStart = colomboDayStart(day);
  const hours = new Map<number, ArchiveRow[]>();
  for (const row of rows) {
    if (colomboDay(row.received_at) !== day) continue;
    const hour = Math.floor((row.received_at - dayStart) / 3_600_000);
    const list = hours.get(hour) ?? [];
    list.push(row);
    hours.set(hour, list);
  }
  return hours;
}
