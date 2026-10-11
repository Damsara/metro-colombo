import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import type { GeoJSONSource, Map as LibreMap } from "maplibre-gl";
import { useEffect, type RefObject } from "react";
import { roadBearing } from "../lib/roadBearing";
import type { Credit, StopDecoration } from "../occasions/types";
import type { Stop } from "../types";
import type { StandModelLayer } from "./StandModelLayer";

const MARKS = "metro-festive";
const CREDIT = "metro-festive-credit";
// Every picture is drawn this many pixels tall at street zoom, whatever its file size.
const MARK_PIXELS = 44;

export type FestiveMap = {
  decoration?: StopDecoration;
  busGlow?: string;
  stops: Stop[];
};

export type Road = readonly (readonly [number, number])[];

export function addFestiveLayers(map: LibreMap, below: string): void {
  map.addSource(MARKS, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer(
    {
      id: MARKS,
      type: "symbol",
      source: MARKS,
      layout: {
        "icon-image": ["get", "mark"],
        "icon-anchor": "bottom",
        "icon-offset": [0, -14],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 15, 1],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    below,
  );
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function creditHtml(credit: Credit, i18n: I18n): string {
  const work = t(i18n)`“${credit.title}” by ${credit.author}`;
  return `${escape(t(i18n)`Decorations`)}: <a href="${escape(credit.href)}" target="_blank" rel="noopener">${escape(work)}</a>, ${escape(credit.license)}`;
}

function showCredit(map: LibreMap, html: string | null): void {
  const current = map.getSource(CREDIT) as
    | (GeoJSONSource & { attribution?: string })
    | undefined;
  if (current && current.attribution === html) return;
  if (current) {
    map.removeLayer(CREDIT);
    map.removeSource(CREDIT);
  }
  if (!html) return;
  map.addSource(CREDIT, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    attribution: html,
  });
  map.addLayer({ id: CREDIT, type: "circle", source: CREDIT });
}

function loadImages(
  map: LibreMap,
  images: readonly { id: string; url: string }[],
  isCancelled: () => boolean,
): Promise<void> {
  return Promise.all(
    images
      .filter(({ id }) => !map.hasImage(id))
      .map(
        ({ id, url }) =>
          new Promise<void>((resolve) => {
            const image = new Image();
            image.onload = () => {
              if (!isCancelled() && !map.hasImage(id))
                map.addImage(id, image, {
                  pixelRatio: image.naturalHeight / MARK_PIXELS,
                });
              resolve();
            };
            image.onerror = () => resolve();
            image.src = url;
          }),
      ),
  ).then(() => undefined);
}

export function useFestiveMap({
  map,
  standLayer,
  festive,
  threeD,
  roads,
  i18n,
  language,
  revision,
}: {
  map: () => LibreMap | undefined;
  standLayer: RefObject<StandModelLayer | null>;
  festive: FestiveMap | null | undefined;
  threeD: boolean;
  roads: readonly Road[];
  i18n: I18n;
  language: string;
  revision: string;
}): void {
  const decoration = festive?.decoration;
  const stops = festive?.stops;
  useEffect(() => {
    const ready = map();
    const source = ready?.getSource(MARKS) as GeoJSONSource | undefined;
    if (!ready || !source) return;
    const marked = decoration ? (stops ?? []) : [];
    const stand = threeD && marked.length ? decoration?.stand : undefined;
    standLayer.current?.show(
      stand,
      stand
        ? marked.map((stop) => {
            const lngLat: [number, number] = [stop.longitude, stop.latitude];
            return { lngLat, roadBearing: roadBearing(lngLat, roads) };
          })
        : [],
    );
    showCredit(
      ready,
      decoration?.credit && marked.length
        ? creditHtml(decoration.credit, i18n)
        : null,
    );
    const images = (decoration?.images ?? []).map((url, index) => ({
      id: `${decoration?.id}-${index}`,
      url,
    }));
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: stand
        ? []
        : marked.map((stop, index) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [stop.longitude, stop.latitude],
            },
            properties: { mark: images[index % images.length].id },
          })),
    };
    let cancelled = false;
    void loadImages(ready, images, () => cancelled).then(() => {
      if (!cancelled) source.setData(data);
    });
    return () => {
      cancelled = true;
    };
  }, [
    map,
    standLayer,
    decoration,
    stops,
    threeD,
    roads,
    i18n,
    language,
    revision,
  ]);
}
