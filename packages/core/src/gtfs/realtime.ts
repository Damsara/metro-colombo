import type { LiveBus } from "../schemas.js";

const VARINT = 0;
const LENGTH = 2;
const FIXED32 = 5;
const utf8 = new TextEncoder();

const varint = (value: number): number[] => {
  const out: number[] = [];
  let rest = Math.floor(value);
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
  return out;
};

const key = (field: number, wire: number) => varint(field * 8 + wire);
const message = (field: number, body: ReadonlyArray<number>) => [...key(field, LENGTH), ...varint(body.length), ...body];
const text = (field: number, value: string) => message(field, [...utf8.encode(value)]);
const uint = (field: number, value: number) => [...key(field, VARINT), ...varint(value)];
const float = (field: number, value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return [...key(field, FIXED32), ...bytes];
};

const vehiclePosition = (bus: LiveBus): number[] => {
  const descriptor = [...text(1, bus.id), ...(bus.registration_number ? text(3, bus.registration_number) : [])];
  const position = [...float(1, bus.lat), ...float(2, bus.lng), ...(bus.heading === undefined ? [] : float(3, bus.heading))];
  const occupancy =
    bus.current_capacity !== undefined && bus.total_capacity
      ? uint(10, Math.min(100, Math.max(0, Math.round((bus.current_capacity / bus.total_capacity) * 100))))
      : [];
  return [
    ...(bus.route_code ? message(1, text(5, bus.route_code)) : []),
    ...message(2, position),
    ...(bus.timestamp === undefined ? [] : uint(5, Math.floor(bus.timestamp / 1000))),
    ...message(8, descriptor),
    ...occupancy,
  ];
};

export function encodeVehiclePositions(buses: ReadonlyArray<LiveBus>, timestampSeconds: number): Uint8Array {
  const header = [...text(1, "2.0"), ...uint(2, 0), ...uint(3, timestampSeconds)];
  const entities = buses.flatMap((bus) => message(2, [...text(1, bus.id), ...message(4, vehiclePosition(bus))]));
  return Uint8Array.from([...message(1, header), ...entities]);
}
