import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP_STYLE } from "../../lib/basemap";
import { palette } from "../../theme";

export type MapPoint = {
  lng: number;
  lat: number;
  size: number;
  color: string;
  label: string;
};

const EMPTY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function collection(points: MapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      properties: {
        size: point.size,
        color: point.color,
        label: point.label,
      },
    })),
  };
}

export function PointsMap({
  points,
  label,
}: {
  points: MapPoint[];
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const latest = useRef(points);
  latest.current = points;
  const fitted = useRef(false);

  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: BASEMAP_STYLE,
      center: [79.9, 6.9],
      zoom: 10.5,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    instance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
    );
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
    });
    instance.on("load", () => {
      instance.addSource("points", { type: "geojson", data: EMPTY });
      instance.addLayer({
        id: "points",
        type: "circle",
        source: "points",
        paint: {
          "circle-radius": ["get", "size"],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.75,
          "circle-stroke-color": palette.card,
          "circle-stroke-width": 1,
        },
      });
      loaded.current = true;
      show(instance, latest.current);
    });
    instance.on("mousemove", "points", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      instance.getCanvas().style.cursor = "pointer";
      popup
        .setLngLat(event.lngLat)
        .setText(String(feature.properties?.label ?? ""))
        .addTo(instance);
    });
    instance.on("mouseleave", "points", () => {
      instance.getCanvas().style.cursor = "";
      popup.remove();
    });
    map.current = instance;
    return () => {
      popup.remove();
      instance.remove();
      map.current = null;
      loaded.current = false;
    };
  }, []);

  function show(instance: maplibregl.Map, next: MapPoint[]) {
    const source = instance.getSource("points") as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(collection(next));
    if (fitted.current || next.length === 0) return;
    fitted.current = true;
    const bounds = new maplibregl.LngLatBounds();
    next.forEach((point) => bounds.extend([point.lng, point.lat]));
    instance.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 0 });
  }

  useEffect(() => {
    if (map.current && loaded.current) show(map.current, points);
  }, [points]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      className="h-80 w-full overflow-hidden rounded-lg border border-line max-md:h-64"
    />
  );
}
