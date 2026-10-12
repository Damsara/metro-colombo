export type CellKind = "timestamp" | "date" | "other";

// Arrow type ids; the archive's times are Colombo wall-clock stored as if UTC.
const TIMESTAMP = 10;
const DATE = 8;

export function cellKind(typeId: number): CellKind {
  if (typeId === TIMESTAMP) return "timestamp";
  if (typeId === DATE) return "date";
  return "other";
}

export function formatCell(value: unknown, kind: CellKind = "other"): string {
  if (value === null || value === undefined) return "–";
  if (
    kind !== "other" &&
    (typeof value === "number" || value instanceof Date)
  ) {
    const iso = new Date(value).toISOString();
    return kind === "date"
      ? iso.slice(0, 10)
      : iso.slice(0, 16).replace("T", " ");
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number")
    return Number.isInteger(value)
      ? String(value)
      : String(Math.round(value * 100) / 100);
  if (typeof value === "string") return value;
  if (typeof value === "object" && Symbol.iterator in value)
    return Array.from(value as Iterable<unknown>)
      .map((item) => formatCell(item))
      .join(", ");
  return String(value);
}
