import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as LibreMap,
} from "maplibre-gl";
import type {
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  Point,
  Position,
} from "geojson";
import { AlertTriangle, MapPin } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { i18n } from "../i18n";
import { MAP_STATUS } from "../classNames";
import {
  dragDistance,
  type FollowEvent,
  type FollowState,
} from "../lib/follow";
import { routeColor as colorForRoute } from "../lib/routeColor";
import { splitRoute } from "../lib/routeSplit";
import { palette } from "../theme";
import { BusModelLayer } from "./BusModelLayer";
import { Button } from "./ui/Button";
import { Notice } from "./ui/Notice";
import {
  busDirection,
  busKey,
  stopName,
  type MapViewProps,
  type Ride,
  type RouteRef,
  type Stop,
} from "../types";

const COLOMBO: [number, number] = [79.8612, 6.9271];
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const ROUTES = "metro-routes";
const ROUTE_LINES = "metro-route-lines";
const SPLIT = "metro-route-split";
const STOPS = "metro-stops";
const STOP_HIT = "metro-stop-hit";
const STOP_COLOR = palette.ink;
const WALK_COLOR = palette.muted;
const FOLLOW_FOCUS = "bus-follow";
const CAMERA_MS = 900;
const FOLLOW_MIN_ZOOM = 15;
// Basemap sources whose errors mean the tile provider couldn't be reached.
const TILE_SOURCES: unknown[] = ["openmaptiles", "ne2_shaded"];
type Line = LineString | MultiLineString;
type MapProperties = Record<string, string | number | boolean>;
type Lines = FeatureCollection<Line, MapProperties>;
type Points = FeatureCollection<Point, MapProperties>;
type Scene = {
  routes: Lines;
  stops: Points;
  stopLookup: Map<string, Stop>;
};
const NO_ROUTES: RouteRef[] = [];
type Warning = "tiles" | "map" | "location" | "permission" | null;

type Props = Omit<MapViewProps, "onFollowChange"> & {
  followState: FollowState | null;
  onFollowEvent: (event: FollowEvent) => void;
  frameRide?: Ride | null;
};

type Insets = Props["insets"];

// Keeps fitted content clear of the caption, legend and control column, or
// on phones of the header, the drawer and the control column.
function viewportPadding(insets: Insets): maplibregl.PaddingOptions {
  if (!insets) return { top: 140, bottom: 110, left: 60, right: 80 };
  return {
    top: insets.top + 24,
    bottom: insets.bottom + 32,
    left: 40,
    right: 72,
  };
}

/** How far below the visible map's centre the screen's centre sits. */
function followShift(insets: Insets): number {
  return insets ? (insets.bottom - insets.top) / 2 : 0;
}

function coordinatesValid(position: Position): boolean {
  return (
    position.length >= 2 &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    Math.abs(position[0]) <= 180 &&
    Math.abs(position[1]) <= 90
  );
}

function stopKey(stop: Stop): string {
  return `${stop.id}:${stop.longitude}:${stop.latitude}`;
}

function stopPosition(stop: Stop): Position {
  return [stop.longitude, stop.latitude];
}

function validStop(stop: Stop): boolean {
  return coordinatesValid(stopPosition(stop));
}

// A missing direction on either side matches any direction.
function directionsMatch(a?: string, b?: string): boolean {
  return !a || !b || a === b;
}

function hiddenByLock(
  route: MapViewProps["routes"][number],
  lock: RouteRef | null,
): boolean {
  return (
    lock !== null &&
    (route.code !== lock.routeCode ||
      !directionsMatch(lock.directionId, route.directionId))
  );
}

function lineCoordinates(geometry: Line): Position[] {
  return geometry.type === "LineString"
    ? geometry.coordinates
    : geometry.coordinates.flat();
}

function pointerPoint(
  event: Event | undefined,
): { x: number; y: number } | null {
  if (event instanceof MouseEvent)
    return { x: event.clientX, y: event.clientY };
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return null;
}

function isMultiTouch(event: Event | undefined): boolean {
  return (
    typeof TouchEvent !== "undefined" &&
    event instanceof TouchEvent &&
    event.touches.length > 1
  );
}

// The closest stop under a tap, measured on screen.
function nearestStop(
  map: LibreMap,
  point: maplibregl.Point,
  lookup: Map<string, Stop>,
): Stop | undefined {
  const features = map.queryRenderedFeatures(point, { layers: [STOP_HIT] });
  let nearest: Stop | undefined;
  let distance = Infinity;
  for (const feature of features) {
    const stop = lookup.get(String(feature.properties?.key));
    if (!stop) continue;
    const projected = map.project([stop.longitude, stop.latitude]);
    const candidate = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (candidate < distance) {
      nearest = stop;
      distance = candidate;
    }
  }
  return nearest;
}

function realLines(geometry: Geometry): Line[] {
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.flatMap(realLines);
  if (geometry.type === "LineString") {
    return geometry.coordinates.length >= 2 &&
      geometry.coordinates.every(coordinatesValid)
      ? [geometry]
      : [];
  }
  if (geometry.type === "MultiLineString") {
    const coordinates = geometry.coordinates.filter(
      (line) => line.length >= 2 && line.every(coordinatesValid),
    );
    return coordinates.length ? [{ type: "MultiLineString", coordinates }] : [];
  }
  return [];
}

type JourneyStopMark = {
  stop: Stop;
  board: boolean;
  alight: boolean;
  /** The route ridden to or from this stop; none for a walk. */
  routeCode?: string;
};

function journeyStops(
  journey: MapViewProps["selectedJourney"],
): JourneyStopMark[] {
  return (
    journey?.legs.flatMap((leg): JourneyStopMark[] => {
      if (leg.kind === "ride") {
        const routeCode = leg.ride.route.code;
        return [
          ...(leg.ride.stops ?? []).map((stop) => ({
            stop,
            board: false,
            alight: false,
            routeCode,
          })),
          { stop: leg.ride.board, board: true, alight: false, routeCode },
          { stop: leg.ride.alight, board: false, alight: true, routeCode },
        ];
      }
      return [leg.move.from_stop, leg.move.to_stop].map((stop) => ({
        stop,
        board: false,
        alight: false,
      }));
    }) ?? []
  );
}

function setScene(map: LibreMap, next: Scene, previous: Scene | null): void {
  if (next.routes !== previous?.routes)
    (map.getSource(ROUTES) as GeoJSONSource | undefined)?.setData(next.routes);
  if (next.stops !== previous?.stops)
    (map.getSource(STOPS) as GeoJSONSource | undefined)?.setData(next.stops);
}

function addTransitLayers(map: LibreMap): void {
  const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
  map.addSource(ROUTES, { type: "geojson", data: empty });
  // Stops are keyed so the one under the mouse can carry a hover state.
  map.addSource(SPLIT, { type: "geojson", data: empty });
  map.addSource(STOPS, { type: "geojson", data: empty, promoteId: "key" });
  // Route lines go under the basemap's place labels; stops stay on top.
  const firstLabel = map
    .getStyle()
    .layers.find((layer) => layer.type === "symbol")?.id;
  map.addLayer(
    {
      id: ROUTE_LINES,
      type: "line",
      source: ROUTES,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["case", ["get", "highlight"], 6, 4],
        // The opened route stands out; the rest of the network steps back.
        "line-opacity": [
          "case",
          ["get", "dimmed"],
          0.2,
          ["get", "highlight"],
          1,
          0.75,
        ],
      },
    },
    firstLabel,
  );
  map.addLayer(
    {
      id: SPLIT,
      type: "line",
      source: SPLIT,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 6,
        "line-opacity": ["case", ["==", ["get", "phase"], "behind"], 0.25, 1],
        "line-opacity-transition": { duration: 0 },
      },
    },
    firstLabel,
  );
  // Stops follow transit-map convention: a white dot ringed in the route's
  // colour, laid flat on the (tilted) map and growing with zoom so the
  // network view stays readable. Journey ends and the selected stop are
  // larger and drawn on top. The selected stop also gets an ink ring on a
  // paper halo, so it reads on any basemap and not by colour alone.
  const end: ExpressionSpecification = [
    "any",
    ["get", "board"],
    ["get", "alight"],
  ];
  const bySize = (
    selected: number,
    ends: number,
    journey: number,
    stop: number,
  ): ExpressionSpecification => [
    "case",
    ["get", "selected"],
    selected,
    end,
    ends,
    ["get", "journey"],
    journey,
    stop,
  ];
  const hovered: ExpressionSpecification = [
    "boolean",
    ["feature-state", "hover"],
    false,
  ];
  map.addLayer({
    id: "metro-stop-halo",
    type: "circle",
    source: STOPS,
    filter: ["get", "selected"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 15, 16, 22],
      "circle-color": palette.paper,
      "circle-opacity": 0.92,
      "circle-stroke-width": 3,
      "circle-stroke-color": palette.ink,
      "circle-pitch-alignment": "map",
    },
  });
  map.addLayer({
    id: "metro-stop-dots",
    type: "circle",
    source: STOPS,
    layout: {
      "circle-sort-key": [
        "case",
        ["get", "selected"],
        3,
        end,
        2,
        ["get", "journey"],
        1,
        0,
      ],
    },
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        ["+", bySize(6, 5, 3, 2.5), ["case", hovered, 1.5, 0]],
        13,
        ["+", bySize(8, 7, 5, 4.5), ["case", hovered, 2, 0]],
        16,
        ["+", bySize(10, 9, 7, 7), ["case", hovered, 2, 0]],
      ],
      "circle-stroke-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        ["case", ["any", ["get", "selected"], end, hovered], 2, 1],
        14,
        ["case", ["any", ["get", "selected"], end, hovered], 3, 2],
      ],
      "circle-color": [
        "case",
        ["get", "selected"],
        ["get", "color"],
        "#ffffff",
      ],
      "circle-stroke-color": [
        "case",
        ["get", "selected"],
        "#ffffff",
        hovered,
        palette.ink,
        ["get", "color"],
      ],
      "circle-pitch-alignment": "map",
    },
  });
  // An invisible 44px target makes small stop dots usable without enlarging the visual clutter.
  map.addLayer({
    id: STOP_HIT,
    type: "circle",
    source: STOPS,
    paint: {
      "circle-radius": 22,
      "circle-color": "#ffffff",
      "circle-opacity": 0,
    },
  });
}

function controlLabels(): Record<string, string> {
  return {
    "NavigationControl.ZoomIn": t(i18n)`Zoom in`,
    "NavigationControl.ZoomOut": t(i18n)`Zoom out`,
    "NavigationControl.ResetBearing": t(i18n)`Point north`,
    "GeolocateControl.FindMyLocation": t(i18n)`Find my location`,
    "GeolocateControl.LocationNotAvailable": t(i18n)`Location unavailable`,
    "AttributionControl.ToggleAttribution": t(i18n)`Map credits`,
  };
}

function labelControls(map: LibreMap): void {
  const labels = controlLabels();
  const selectors: Record<string, string> = {
    ".maplibregl-ctrl-zoom-in": "NavigationControl.ZoomIn",
    ".maplibregl-ctrl-zoom-out": "NavigationControl.ZoomOut",
    ".maplibregl-ctrl-compass": "NavigationControl.ResetBearing",
    ".maplibregl-ctrl-geolocate": "GeolocateControl.FindMyLocation",
    ".maplibregl-ctrl-attrib-button": "AttributionControl.ToggleAttribution",
  };
  for (const [selector, key] of Object.entries(selectors)) {
    const button = map
      .getContainer()
      .querySelector<HTMLButtonElement>(selector);
    const label =
      labels[
        selector === ".maplibregl-ctrl-geolocate" && button?.disabled
          ? "GeolocateControl.LocationNotAvailable"
          : key
      ];
    button?.setAttribute("aria-label", label);
    button?.setAttribute("title", label);
  }
  map
    .getCanvas()
    .setAttribute(
      "aria-label",
      t(i18n)`Transit map. Use arrow keys to move and plus or minus to zoom.`,
    );
}

// Bus icon (lucide BusFront viewBox) used inside the native control button.
const BUS_ICON_PATH =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="M6 19v2"/><path d="M18 21v-2"/></svg>';

function liveBusLabels(show: boolean): { aria: string; title: string } {
  const label = show ? t(i18n)`Hide live buses` : t(i18n)`Show live buses`;
  return { aria: label, title: label };
}

class LiveBusesControl implements maplibregl.IControl {
  private container: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;

  constructor(
    private show: boolean,
    private labels: (show: boolean) => { aria: string; title: string },
    private onToggle: () => void,
  ) {}

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "map-live-toggle-ctrl";
    this.button.innerHTML = BUS_ICON_PATH;
    this.button.addEventListener("click", this.onToggle);
    this.container.appendChild(this.button);
    this.update(this.show);
    return this.container;
  }

  onRemove(): void {
    this.button?.removeEventListener("click", this.onToggle);
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.button = null;
  }

  update(show: boolean): void {
    this.show = show;
    if (!this.button) return;
    const { aria, title } = this.labels(show);
    this.button.setAttribute("aria-pressed", String(show));
    this.button.setAttribute("aria-label", aria);
    this.button.setAttribute("title", title);
  }

  setLabels(labels: (show: boolean) => { aria: string; title: string }): void {
    this.labels = labels;
    this.update(this.show);
  }
}

export default function MapView(props: Props) {
  const {
    routes,
    routeCatalog,
    stops,
    buses,
    from,
    to,
    selectedStop,
    selectedJourney,
    selectedBus,
    followBus,
    frameRide = null,
    language,
    showLive,
    insets,
    routeLock = null,
    emphasizeRoutes = NO_ROUTES,
    busOverlay,
  } = props;
  const { t } = useLingui();
  const selectedBusKey = selectedBus ? busKey(selectedBus) : "";
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const liveControlRef = useRef<LiveBusesControl | null>(null);
  const busLayerRef = useRef<BusModelLayer | null>(null);
  const ready = useRef(false);
  const appliedScene = useRef<Scene | null>(null);
  const appliedFocus = useRef<string | null>(null);
  // Whether the user has moved the map since it was last framed.
  const userMoved = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [warning, setWarning] = useState<Warning>(null);
  const [attempt, setAttempt] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const selectedBusRoute = selectedBus?.route_code ?? "";
  const routeData = useMemo<Lines>(
    () => ({
      type: "FeatureCollection",
      features: routes.flatMap((route) => {
        if (hiddenByLock(route, routeLock)) return [];
        const highlight = emphasizeRoutes.some(
          (item) =>
            item.routeCode === route.code &&
            directionsMatch(item.directionId, route.directionId),
        );
        // A tracked bus quietens other routes too, without moving the camera
        // to its route the way an opened route does.
        const dimmed = emphasizeRoutes.length
          ? !emphasizeRoutes.some((item) => item.routeCode === route.code)
          : selectedBusRoute !== "" && route.code !== selectedBusRoute;
        return route.geometry.features.flatMap((feature) =>
          feature.geometry
            ? realLines(feature.geometry).map((geometry) => ({
                type: "Feature" as const,
                geometry,
                properties: {
                  code: route.code,
                  direction: route.directionId ?? "",
                  color: colorForRoute(route.color),
                  highlight,
                  dimmed,
                },
              }))
            : [],
        );
      }),
    }),
    [routes, routeLock, emphasizeRoutes, selectedBusRoute],
  );

  const busLat = selectedBus?.lat;
  const busLng = selectedBus?.lng;
  const busRouteCode = selectedBus?.route_code;
  const busDirectionId = selectedBus?.direction_id;
  const busSplit = useMemo(() => {
    if (busLat === undefined || busLng === undefined) return null;
    const direction = busDirection(
      routeCatalog.find((item) => item.code === busRouteCode),
      busDirectionId,
    );
    const route = direction
      ? routes.find(
          (item) =>
            item.code === busRouteCode && item.directionId === direction.id,
        )
      : undefined;
    const split = route && splitRoute(route, { lat: busLat, lng: busLng });
    if (!route || !split) return null;
    const color = colorForRoute(route.color);
    const piece = (phase: string, lines: Position[][]) =>
      lines.map((coordinates) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates },
        properties: { phase, color },
      }));
    return {
      hidden: `${route.code}\n${route.directionId}`,
      data: {
        type: "FeatureCollection" as const,
        features: [
          ...piece("behind", split.behind),
          ...piece("ahead", split.ahead),
        ],
      },
    };
  }, [busLat, busLng, busRouteCode, busDirectionId, routes, routeCatalog]);

  const stopScene = useMemo(() => {
    const lookup = new Map<string, Stop>();
    const properties = new Map<string, MapProperties>();
    // Stops on an opened route take its colour; elsewhere they are neutral.
    const routeColor = (code: string | undefined) =>
      routes.find((route) => route.code === code)?.color;
    const baseColor = routeColor(emphasizeRoutes[0]?.routeCode) ?? STOP_COLOR;
    const add = (
      stop: Stop,
      journey = false,
      board = false,
      alight = false,
      color = baseColor,
    ) => {
      if (!validStop(stop)) return;
      const key = stopKey(stop);
      lookup.set(key, stop);
      const previous = properties.get(key);
      properties.set(key, {
        key,
        journey: journey || previous?.journey === true,
        board: board || previous?.board === true,
        alight: alight || previous?.alight === true,
        selected: Boolean(selectedStop && stopKey(selectedStop) === key),
        color: journey ? color : (previous?.color ?? color),
      });
    };
    stops.forEach((stop) => add(stop));
    journeyStops(selectedJourney).forEach((item) =>
      add(
        item.stop,
        true,
        item.board,
        item.alight,
        item.routeCode ? (routeColor(item.routeCode) ?? baseColor) : WALK_COLOR,
      ),
    );
    if (from) add(from);
    if (to) add(to);
    if (selectedStop) add(selectedStop);
    const data: Points = {
      type: "FeatureCollection",
      features: [...lookup].map(([key, stop]) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: stopPosition(stop),
        },
        properties: properties.get(key)!,
      })),
    };
    return { data, lookup };
  }, [stops, selectedStop, selectedJourney, from, to, routes, emphasizeRoutes]);

  const scene = useMemo<Scene>(
    () => ({
      routes: routeData,
      stops: stopScene.data,
      stopLookup: stopScene.lookup,
    }),
    [routeData, stopScene],
  );

  const following = followBus && selectedBusKey !== "";
  const focus = useMemo(() => {
    if (following) return { coordinates: [], key: FOLLOW_FOCUS };
    let coordinates: Position[] = [];
    let kind = "route";
    if (selectedStop && validStop(selectedStop)) {
      kind = "stop";
      coordinates = [stopPosition(selectedStop)];
    } else if (frameRide) {
      kind = "ride";
      coordinates = [
        frameRide.board,
        ...(frameRide.stops ?? []),
        frameRide.alight,
      ]
        .filter(validStop)
        .map(stopPosition);
    } else if (selectedJourney) {
      kind = "journey";
      coordinates = journeyStops(selectedJourney)
        .filter((item) => validStop(item.stop))
        .map(({ stop }) => stopPosition(stop));
    } else if ((from && validStop(from)) || (to && validStop(to))) {
      kind = "endpoints";
      coordinates = [from, to]
        .filter((stop): stop is Stop => Boolean(stop && validStop(stop)))
        .map(stopPosition);
    } else {
      // An opened route fills the view; otherwise the whole network does.
      const shown = emphasizeRoutes.length
        ? routeData.features.filter((feature) => feature.properties.highlight)
        : routeData.features;
      coordinates = shown.flatMap((feature) =>
        lineCoordinates(feature.geometry),
      );
      coordinates.push(...stops.filter(validStop).map(stopPosition));
    }
    return {
      coordinates,
      key: `${kind}:${coordinates.map((position) => `${position[0]},${position[1]}`).join(";")}`,
    };
  }, [
    selectedStop,
    frameRide,
    selectedJourney,
    from,
    to,
    routeData,
    emphasizeRoutes,
    stops,
    following,
  ]);

  const latest = useRef({ props, scene, focus });
  useEffect(() => {
    latest.current = { props, scene, focus };
  }, [props, scene, focus]);

  const syncBuses = useCallback(() => {
    const { buses, showLive, routes, routeCatalog } = latest.current.props;
    busLayerRef.current?.setFixes(showLive ? buses : [], routes, routeCatalog);
  }, []);

  const applyFocus = useCallback((map: LibreMap, next: typeof focus): void => {
    if (appliedFocus.current === next.key) return;
    // The first view is shown at once; later changes glide to the new view.
    const firstView = appliedFocus.current === null;
    // Leaving follow mode keeps the camera where the user (or the bus) left it.
    const wasFollowing = appliedFocus.current === FOLLOW_FOCUS;
    appliedFocus.current = next.key;
    if (wasFollowing && !next.key.startsWith("ride:")) return;
    if (next.coordinates.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    next.coordinates.forEach((position) =>
      bounds.extend([position[0], position[1]]),
    );
    const single = next.coordinates.length === 1;
    userMoved.current = false;
    map.fitBounds(bounds, {
      padding: viewportPadding(latest.current.props.insets),
      maxZoom: single ? 16 : 14,
      // MapLibre skips the animation when the user prefers reduced motion.
      duration: firstView ? 0 : CAMERA_MS,
    });
  }, []);

  useEffect(() => {
    if (!container.current) return;
    let map: LibreMap | undefined;
    let disposed = false;
    let failed = false;
    let observer: ResizeObserver | undefined;
    let resizeFrame: number | undefined;
    let canvas: HTMLCanvasElement | undefined;
    const markUnavailable = () => {
      failed = true;
      ready.current = false;
      setStatus("unavailable");
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      if (!disposed) markUnavailable();
    };
    const resize = () => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!disposed) map?.resize();
      });
    };
    setStatus("loading");
    setWarning(null);
    ready.current = false;
    appliedScene.current = null;
    appliedFocus.current = null;
    try {
      map = new maplibregl.Map({
        container: container.current,
        center: COLOMBO,
        zoom: 11,
        pitch: 40,
        bearing: 0,
        locale: controlLabels(),
        style: BASEMAP_STYLE,
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      const activeMap = map;
      canvas = activeMap.getCanvas();
      canvas.addEventListener("webglcontextlost", contextLost);
      activeMap.addControl(
        new maplibregl.NavigationControl({ showCompass: true }),
        "top-right",
      );
      const geolocation = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true, timeout: 12000 },
        trackUserLocation: true,
        showUserLocation: true,
        showAccuracyCircle: true,
        fitBoundsOptions: { maxZoom: 16, duration: CAMERA_MS },
      });
      activeMap.addControl(geolocation, "top-right");
      const liveControl = new LiveBusesControl(
        latest.current.props.showLive,
        liveBusLabels,
        () =>
          latest.current.props.onShowLiveChange(!latest.current.props.showLive),
      );
      liveControlRef.current = liveControl;
      activeMap.addControl(liveControl, "top-right");
      geolocation.on("error", (event) => {
        if (!disposed) setWarning(event.code === 1 ? "permission" : "location");
      });
      geolocation.on("geolocate", () => {
        if (!disposed)
          setWarning((current) =>
            current === "permission" || current === "location" ? null : current,
          );
      });
      labelControls(activeMap);
      activeMap.on("movestart", (event) => {
        // Gestures carry the event that started them; our own camera moves don't.
        if ("originalEvent" in event && event.originalEvent)
          userMoved.current = true;
      });
      activeMap.on("error", (event) => {
        if (disposed) return;
        if (/webgl|context lost/i.test(event.error.message)) markUnavailable();
        else
          setWarning(
            "sourceId" in event && TILE_SOURCES.includes(event.sourceId)
              ? "tiles"
              : "map",
          );
      });
      activeMap.on("load", () => {
        if (disposed || failed) return;
        try {
          addTransitLayers(activeMap);
          const vehicles = new BusModelLayer();
          busLayerRef.current = vehicles;
          activeMap.addLayer(vehicles);
          ready.current = true;
          syncBuses();
          setScene(activeMap, latest.current.scene, null);
          appliedScene.current = latest.current.scene;
          applyFocus(activeMap, latest.current.focus);
          setStatus("ready");
        } catch {
          markUnavailable();
        }
      });
      // Returns false when the tapped bus has already left the feed.
      const tapBus = (id: string): boolean => {
        const { buses, selectedBus, onBusSelect, onFollowEvent } =
          latest.current.props;
        const bus = buses.find((candidate) => busKey(candidate) === id);
        if (!bus) return false;
        const alreadySelected =
          Boolean(selectedBus) && busKey(selectedBus!) === id;
        if (alreadySelected) onFollowEvent({ type: "tapSelected" });
        else onBusSelect(bus);
        return true;
      };
      activeMap.on("click", (event) => {
        if (!ready.current) return;
        const busId = busLayerRef.current?.pick(event.point);
        if (busId && tapBus(busId)) return;
        if (!activeMap.getLayer(STOP_HIT)) return;
        const nearest = nearestStop(
          activeMap,
          event.point,
          latest.current.scene.stopLookup,
        );
        // A tap away from any stop or bus puts the stop's card away.
        latest.current.props.onStopSelect(nearest ?? null);
      });
      // The stop under the mouse lifts a little, on pointers that can hover.
      let hoverKey: string | null = null;
      const setHover = (key: string | null) => {
        if (key === hoverKey) return;
        if (hoverKey !== null)
          activeMap.setFeatureState(
            { source: STOPS, id: hoverKey },
            { hover: false },
          );
        hoverKey = key;
        if (key !== null)
          activeMap.setFeatureState(
            { source: STOPS, id: key },
            { hover: true },
          );
      };
      activeMap.on("mousemove", (event) => {
        if (!ready.current || !activeMap.getLayer(STOP_HIT)) return;
        const overBus = busLayerRef.current?.pick(event.point);
        const overStop = overBus
          ? undefined
          : nearestStop(
              activeMap,
              event.point,
              latest.current.scene.stopLookup,
            );
        if (window.matchMedia("(hover: hover)").matches)
          setHover(overStop ? stopKey(overStop) : null);
        canvas!.style.cursor = overStop || overBus ? "pointer" : "";
      });
      activeMap.on("mouseout", () => {
        if (ready.current) setHover(null);
      });
      // A two-finger pinch also reports a small drag, so only one-finger touch
      // drags count.
      let dragStart: { x: number; y: number } | null = null;
      activeMap.on("dragstart", (event) => {
        dragStart = isMultiTouch(event.originalEvent)
          ? null
          : pointerPoint(event.originalEvent);
      });
      activeMap.on("drag", (event) => {
        const point = pointerPoint(event.originalEvent);
        if (!dragStart || !point || isMultiTouch(event.originalEvent)) return;
        latest.current.props.onFollowEvent({
          type: "drag",
          distance: dragDistance(dragStart, point),
        });
      });
      activeMap.on("dragend", () => {
        dragStart = null;
      });
      activeMap.on("movestart", (event) => {
        if (
          event.originalEvent instanceof KeyboardEvent &&
          event.originalEvent.key.startsWith("Arrow")
        )
          latest.current.props.onFollowEvent({ type: "pan" });
      });
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(resize);
        observer.observe(container.current);
      }
      window.addEventListener("resize", resize);
    } catch {
      setStatus("unavailable");
    }
    return () => {
      disposed = true;
      ready.current = false;
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      canvas?.removeEventListener("webglcontextlost", contextLost);
      if (mapRef.current === map) mapRef.current = null;
      liveControlRef.current = null;
      busLayerRef.current = null;
      map?.remove();
    };
  }, [attempt, applyFocus]);

  useEffect(() => {
    liveControlRef.current?.update(showLive);
  }, [showLive]);

  useEffect(() => {
    liveControlRef.current?.setLabels(liveBusLabels);
  }, [language]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    try {
      setScene(map, scene, appliedScene.current);
      appliedScene.current = scene;
      applyFocus(map, focus);
    } catch {
      ready.current = false;
      setStatus("unavailable");
    }
  }, [scene, focus, applyFocus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    try {
      (map.getSource(SPLIT) as GeoJSONSource | undefined)?.setData(
        busSplit?.data ?? { type: "FeatureCollection", features: [] },
      );
    } catch {
      ready.current = false;
      setStatus("unavailable");
    }
  }, [busSplit, attempt, status]);

  const hiddenLine = busSplit?.hidden ?? "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const [code, direction] = hiddenLine.split("\n");
    try {
      map.setFilter(
        ROUTE_LINES,
        hiddenLine
          ? [
              "!",
              [
                "all",
                ["==", ["get", "code"], code],
                ["==", ["get", "direction"], direction],
              ],
            ]
          : null,
      );
    } catch {
      ready.current = false;
      setStatus("unavailable");
    }
  }, [hiddenLine, attempt, status]);

  // When the phone drawer settles at a new height, frame the view again above
  // it, unless the user has moved the map since.
  const insetTop = insets?.top ?? 0;
  const insetBottom = insets?.bottom ?? 0;
  useEffect(() => {
    const map = mapRef.current;
    const applied = appliedFocus.current;
    if (!map || !ready.current || userMoved.current) return;
    if (applied === null || applied === FOLLOW_FOCUS) return;
    appliedFocus.current = "";
    applyFocus(map, latest.current.focus);
  }, [insetTop, insetBottom, applyFocus]);

  useEffect(() => {
    if (ready.current) syncBuses();
  }, [buses, showLive, routes, routeCatalog, syncBuses]);

  useEffect(() => {
    busLayerRef.current?.setSelected(selectedBusKey);
  }, [selectedBusKey, attempt, status]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      busLayerRef.current?.setReducedMotion(preference.matches);
      setReducedMotion(preference.matches);
    };
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, [attempt, status]);

  // Follow the bus's animated position, not its 5-second GPS fixes.
  useEffect(() => {
    const map = mapRef.current;
    if (!following || status !== "ready" || !map) return;
    // Zoom gestures keep the bus centred while following.
    const around = { around: "center" as const };
    map.scrollZoom.disable();
    map.scrollZoom.enable(around);
    map.touchZoomRotate.disable();
    map.touchZoomRotate.enable(around);
    let frame = 0;
    // Glide to the bus first, then track it frame by frame. A zoom or rotate
    // in progress is left alone, then the camera glides back onto the bus.
    let phase: "start" | "gliding" | "tracking" = "start";
    let firstGlide = true;
    let lastCentred = "";
    const settle = () => {
      phase = "tracking";
    };
    const tick = () => {
      const position = busLayerRef.current?.positionOf(selectedBusKey);
      if (position) {
        if (phase === "start" && !map.isMoving()) {
          phase = "gliding";
          map.once("moveend", settle);
          map.easeTo({
            center: position,
            // Only the first glide zooms in; later ones keep the user's zoom.
            zoom: firstGlide
              ? Math.max(map.getZoom(), FOLLOW_MIN_ZOOM)
              : map.getZoom(),
            // On phones, keep the bus in the map left between header and drawer.
            offset: [0, -followShift(latest.current.props.insets)],
            duration: firstGlide ? CAMERA_MS : CAMERA_MS / 2,
          });
          firstGlide = false;
        } else if (phase === "tracking" && map.isMoving()) {
          phase = "start";
        } else if (phase === "tracking") {
          const shift = followShift(latest.current.props.insets);
          const centred = `${position[0]},${position[1]},${shift}`;
          if (!reducedMotion || centred !== lastCentred) {
            lastCentred = centred;
            const center = shift
              ? map.unproject(
                  map.project(position).add(new maplibregl.Point(0, shift)),
                )
              : position;
            map.jumpTo({ center });
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      map.off("moveend", settle);
      map.scrollZoom.disable();
      map.scrollZoom.enable();
      map.touchZoomRotate.disable();
      map.touchZoomRotate.enable();
    };
  }, [following, selectedBusKey, status, reducedMotion]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) labelControls(map);
  }, [language, attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status === "unavailable") return;
    const markers: maplibregl.Marker[] = [];
    for (const [kind, stop, letter] of [
      ["from", from, "A"],
      ["to", to, "B"],
    ] as const) {
      if (!stop || !validStop(stop)) continue;
      const element = document.createElement("div");
      // A pin whose point sits on the stop.
      element.className = `relative grid size-8 place-items-center rounded-full border-2 border-white text-sm font-bold text-white shadow-float after:absolute after:top-full after:left-1/2 after:-mt-px after:-translate-x-1/2 after:border-x-[6px] after:border-t-[9px] after:border-x-transparent ${
        kind === "from"
          ? "bg-brand after:border-t-brand"
          : "bg-destination after:border-t-destination"
      }`;
      element.setAttribute("role", "img");
      const stopLabel = stopName(stop, language);
      const name =
        kind === "from" ? t`Start: ${stopLabel}` : t`Destination: ${stopLabel}`;
      element.setAttribute("aria-label", name);
      element.title = name;
      element.textContent = letter;
      markers.push(
        new maplibregl.Marker({ element, anchor: "bottom", offset: [0, -8] })
          .setLngLat([stop.longitude, stop.latitude])
          .addTo(map),
      );
    }
    return () => {
      markers.forEach((marker) => marker.remove());
    };
  }, [from, to, language, attempt, status]);

  const warningMessage =
    warning === "permission"
      ? t`Location permission was not granted. You can still choose your stops.`
      : warning === "location"
        ? t`Your location could not be found. Choose your stops instead.`
        : warning === "tiles"
          ? t`Map tiles could not load from the external map provider. Check your internet connection. You can still plan your journey.`
          : t`Some map content could not load. The map or network connection may be unavailable. You can still plan your journey.`;
  return (
    <section
      className="relative h-full w-full"
      aria-label={t`Routes and stops map`}
    >
      <div className="relative h-full w-full">
        <div
          ref={container}
          className={`relative h-full w-full ${status === "unavailable" ? "invisible" : ""}`}
          aria-hidden={status === "unavailable"}
        />
        {status === "ready" && busOverlay}
        {status === "loading" && (
          <p className={MAP_STATUS} role="status">
            {t`Loading map…`}
          </p>
        )}
        {status === "unavailable" && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center bg-map px-7 pt-24 pb-56 text-center text-muted"
            role="status"
          >
            <MapPin aria-hidden="true" size={32} />
            <h3 className="mt-4 mb-2 text-2xl text-ink">
              {t`Map unavailable`}
            </h3>
            <p className="max-w-96 text-md leading-relaxed">
              {t`The map needs an internet connection and browser WebGL support. You can still choose stops and plan your journey.`}
            </p>
            <Button
              variant="neutral"
              size="sm"
              className="mt-3"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t`Try map again`}
            </Button>
          </div>
        )}
      </div>
      {warning && status !== "unavailable" && (
        <Notice
          tone="warning"
          icon={<AlertTriangle aria-hidden="true" size={20} />}
          className="absolute top-31 left-7.5 max-w-88 text-xs max-md:top-[calc(var(--header-height,60px)+8px)] max-md:right-16 max-md:left-3 max-md:max-w-none"
          action={
            (warning === "tiles" || warning === "map") && (
              <Button
                variant="neutral"
                size="sm"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t`Try map again`}
              </Button>
            )
          }
        >
          {warningMessage}
        </Notice>
      )}
      <div className="sr-only" aria-label={t`Map key`}>
        <span>
          <i aria-hidden="true" />
          {t`Stop`}
        </span>
        {selectedJourney && (
          <span>
            <i aria-hidden="true" />
            {t`Journey stops; rings show boarding and getting off`}
          </span>
        )}
        {showLive && (
          <span>
            <i aria-hidden="true" />
            {t`Live bus; tap to select and follow`}
          </span>
        )}
        {(from || to) && <span>{t`A: Start · B: Destination`}</span>}
      </div>
    </section>
  );
}
