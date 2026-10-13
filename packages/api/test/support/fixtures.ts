import type { S } from "@metro/core";

// 09:00 in Colombo on 13 Oct 2026.
export const T0 = Date.parse("2026-10-13T03:30:00Z");

const dir = (id: string, from: string, to: string) => ({
  id,
  start_location: from,
  end_location: to,
  status: "active",
  geojson_url: `https://storage.googleapis.com/lmt/${id}.geojson`,
});

export const CM06 = {
  code: "CM06",
  id: "route-6",
  name: "Kollupitiya Circular Route",
  status: "active",
  is_favorite: false,
  directions: [
    dir("d1", "Kollupitiya", "Bambalapitiya"),
    dir("d2", "Bambalapitiya", "Kollupitiya"),
  ],
  color_hex: "#491C80",
};
export const CM01 = {
  code: "CM01",
  id: "route-1",
  name: "Makumbura - Colombo Fort",
  status: "active",
  is_favorite: false,
  directions: [dir("c1", "Makumbura", "Colombo")],
  color_hex: "#1A5A96",
};
export const ROUTES = [CM06, CM01];

export const stop = (id: string, code: string): S.Stop => ({
  id,
  stop_code: code,
  stop_name_en: code,
  stop_name_si: "",
  stop_name_tm: "",
  sequence_number: 1,
  latitude: 6.9120149,
  longitude: 79.850639,
  status: "active",
});

const entry = (route: typeof CM06, index: number, stops: S.Stop[]) => ({
  route_code: route.code,
  route_name: route.name,
  direction_id: route.directions[index].id,
  direction_label: `${route.directions[index].start_location} -> ${route.directions[index].end_location}`,
  stops,
});
export const STOPS_CM06 = [
  entry(CM06, 0, [stop("s1", "KCR100"), stop("s2", "KCR101")]),
  entry(CM06, 1, [stop("s2", "KCR101"), stop("s1", "KCR100")]),
];
export const STOPS_CM01 = [entry(CM01, 0, [stop("s9", "MKB100")])];

const line = (lng: number) => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[lng, 6.91]] },
    },
  ],
});
export const GEOMETRY = { d1: line(79.85), d2: line(79.86), c1: line(79.9) };

export const PLACES = [
  {
    id: 1,
    name: "Lotus Tower Colombo",
    name_si: "නෙළුම් කුලුණ කොළඹ",
    name_ta: "தாமரை கோபுரம் கொழும்பு",
    category: "Landmark",
    walk_meters: 657,
    stop_code: "KCR100",
    stop_id: "s1",
  },
];

export const OCCASIONS = [
  { date: "2026-10-12", title: "Yesterday", kind: "poya" },
  { date: "2026-10-25", title: "Vap Full Moon Poya Day", kind: "poya" },
  { date: "2026-11-08", title: "Deepavali Festival Day", kind: "deepavali" },
];

export const STOP_IDS = { KCR100: "s1", KCR101: "s2", MKB100: "s9" };

export const REFERENCE: Record<string, unknown> = {
  routes: ROUTES,
  "stops/CM06": STOPS_CM06,
  "stops/CM01": STOPS_CM01,
  "paths/CM06/d1": GEOMETRY.d1,
  "paths/CM06/d2": GEOMETRY.d2,
  "paths/CM01/c1": GEOMETRY.c1,
  places: PLACES,
  occasions: OCCASIONS,
  "stop-ids": STOP_IDS,
};
