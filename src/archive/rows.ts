import { gzipSync } from "node:zlib";

export type RecordedFix = {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly receivedAt: number;
  readonly registration_number?: string;
  readonly route_id?: string;
  readonly route_code?: string;
  readonly direction_id?: string;
  readonly heading?: number;
  readonly current_capacity?: number;
  readonly total_capacity?: number;
  readonly timestamp?: number;
};

export type ArchiveRow = {
  readonly bus_id: string;
  readonly registration?: string;
  readonly route_id?: string;
  readonly route_code?: string;
  readonly direction_id?: string;
  readonly lat: number;
  readonly lng: number;
  readonly heading?: number;
  readonly passengers?: number;
  readonly capacity?: number;
  readonly reported_at?: number;
  readonly received_at: number;
};

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

export function toArchiveRow(fix: RecordedFix): ArchiveRow {
  return {
    bus_id: fix.id,
    ...optional("registration", fix.registration_number),
    ...optional("route_id", fix.route_id),
    ...optional("route_code", fix.route_code),
    ...optional("direction_id", fix.direction_id),
    lat: fix.lat,
    lng: fix.lng,
    ...optional("heading", fix.heading),
    ...optional("passengers", fix.current_capacity),
    ...optional("capacity", fix.total_capacity),
    ...optional("reported_at", fix.timestamp),
    received_at: fix.receivedAt,
  };
}

export function dedupe(rows: ReadonlyArray<ArchiveRow>): ArchiveRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.bus_id}|${row.reported_at ?? `r${row.received_at}`}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const COLOMBO_UTC_OFFSET_MS = 5.5 * 3_600_000;

const colombo = (ms: number) =>
  new Date(ms + COLOMBO_UTC_OFFSET_MS).toISOString();

export const colomboDay = (ms: number) => colombo(ms).slice(0, 10);

export const todayPrefix = (ms: number) => `raw/${colomboDay(ms)}/`;

export function chunkKey(ms: number, instance: string): string {
  const time = colombo(ms).slice(11, 19).replaceAll(":", "");
  return `${todayPrefix(ms)}${time}-${instance}.ndjson.gz`;
}

export function encodeChunk(rows: ReadonlyArray<ArchiveRow>): Uint8Array {
  return gzipSync(rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

// Collects only after the first take, so nothing piles up when no recorder is running.
export class RecordBuffer<T> {
  private items: T[] = [];
  private recording = false;
  dropped = 0;

  constructor(private readonly cap: number) {}

  push(item: T): void {
    if (!this.recording) return;
    this.items.push(item);
    if (this.items.length > this.cap) {
      this.items.shift();
      this.dropped += 1;
    }
  }

  take(): T[] {
    this.recording = true;
    const items = this.items;
    this.items = [];
    return items;
  }
}
