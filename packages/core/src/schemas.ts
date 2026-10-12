import { Schema } from "effect";

export const Direction = Schema.Struct({
  id: Schema.String,
  start_location: Schema.String,
  end_location: Schema.String,
  status: Schema.String,
  geojson_url: Schema.String,
});

export const Route = Schema.Struct({
  code: Schema.String,
  id: Schema.String,
  name: Schema.String,
  color_hex: Schema.optional(Schema.String),
  status: Schema.String,
  is_favorite: Schema.Boolean,
  directions: Schema.Array(Direction),
});

export const Stop = Schema.Struct({
  id: Schema.String,
  stop_code: Schema.String,
  stop_name_en: Schema.String,
  stop_name_si: Schema.String,
  stop_name_tm: Schema.String,
  sequence_number: Schema.Number,
  latitude: Schema.Number,
  longitude: Schema.Number,
  status: Schema.String,
});

export const RouteStops = Schema.Struct({
  route_code: Schema.String,
  route_name: Schema.String,
  direction_id: Schema.String,
  direction_label: Schema.String,
  stops: Schema.Array(Stop),
});

export const Place = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  name_si: Schema.String,
  name_ta: Schema.String,
  category: Schema.String,
  walk_meters: Schema.Number,
  stop_code: Schema.String,
  stop_id: Schema.String,
});

export const LiveBus = Schema.Struct({
  id: Schema.String,
  lat: Schema.Number,
  lng: Schema.Number,
  route_code: Schema.optional(Schema.String),
  route_id: Schema.optional(Schema.String),
  direction_id: Schema.optional(Schema.String),
  registration_number: Schema.optional(Schema.String),
  heading: Schema.optional(Schema.Number),
  current_capacity: Schema.optional(Schema.Number),
  total_capacity: Schema.optional(Schema.Number),
  timestamp: Schema.optional(Schema.Number),
});

export const LiveFeed = Schema.Struct({
  success: Schema.Boolean,
  count: Schema.Number,
  timestamp: Schema.Number,
  age_ms: Schema.optional(Schema.Number),
  buses: Schema.Array(LiveBus),
});

// Plans are passed through because the nested `legs` are complex and versioned by the backend.
const OpenRecord = Schema.Record(Schema.String, Schema.Unknown);

export const JourneyPlan = Schema.Struct({
  from_stop: OpenRecord,
  to_stop: OpenRecord,
  date: Schema.String,
  queried_at: Schema.String,
  is_now: Schema.Boolean,
  options: Schema.Array(OpenRecord),
});

export type Direction = Schema.Schema.Type<typeof Direction>;
export type Route = Schema.Schema.Type<typeof Route>;
export type Stop = Schema.Schema.Type<typeof Stop>;
export type RouteStops = Schema.Schema.Type<typeof RouteStops>;
export type Place = Schema.Schema.Type<typeof Place>;
export type LiveBus = Schema.Schema.Type<typeof LiveBus>;
export type LiveFeed = Schema.Schema.Type<typeof LiveFeed>;
export type JourneyPlan = Schema.Schema.Type<typeof JourneyPlan>;
