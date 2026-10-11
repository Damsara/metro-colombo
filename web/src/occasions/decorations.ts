import christmasTree from "../assets/occasions/christmas-tree.png";
import christmasTrees from "../assets/occasions/christmas-trees.glb?url";
import lanternBlue from "../assets/occasions/lantern-blue.png";
import lanternPeach from "../assets/occasions/lantern-peach.png";
import lanternRed from "../assets/occasions/lantern-red.png";
import lanternYellow from "../assets/occasions/lantern-yellow.png";
import vesakLanterns from "../assets/occasions/vesak-lanterns.glb?url";
import type { StopDecoration, Wind } from "./types";

const OUTLINE = "#8f6200";

export function svgImage(shape: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">${shape}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// The south-west monsoon blows towards the north-east.
export const MONSOON: Wind = {
  towards: { x: Math.SQRT1_2, z: -Math.SQRT1_2 },
  lean: 0.07,
  gust: 0.09,
  sway: 0.06,
};

export const LANTERNS: StopDecoration = {
  id: "lantern",
  images: [lanternBlue, lanternYellow, lanternRed, lanternPeach],
  stand: {
    model: vesakLanterns,
    meters: 9,
    pixels: { city: 20, street: 44 },
    pole: { color: 0xc8a464, height: 2.6, arm: 0.55 },
    wind: MONSOON,
  },
  credit: {
    title: "Vesak Lanterns",
    author: "sadeesha",
    href: "https://sketchfab.com/3d-models/vesak-lanterns-46bc0c19982940939bcd73710b55ee36",
    license: "CC BY 4.0",
  },
};

export const CHRISTMAS_TREES: StopDecoration = {
  id: "christmas-tree",
  images: [christmasTree],
  stand: {
    model: christmasTrees,
    meters: 7,
    pixels: { city: 26, street: 64 },
  },
  credit: {
    title: "Christmas tree",
    author: "Brian Seoane",
    href: "https://sketchfab.com/3d-models/christmas-tree-7869dd72aa6f4db0a8416f2d630370ed",
    license: "CC BY 4.0",
  },
};

export const OIL_LAMPS: StopDecoration = {
  id: "oil-lamp",
  images: [
    svgImage(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6d0"/><stop offset="0.5" stop-color="#f6c440"/><stop offset="1" stop-color="#e07a1f"/></linearGradient></defs><path d="M18 3C23 10 25 16 25 21a7 7 0 0 1-14 0c0-5 2-11 7-18Z" fill="url(#g)" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/><path d="M4 28h28c0 8-6 14-14 14S4 36 4 28Z" fill="#b4542a" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>`,
    ),
  ],
};

export const STARS: StopDecoration = {
  id: "star",
  images: [
    svgImage(
      `<defs><radialGradient id="g" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6d0"/><stop offset="0.6" stop-color="#f6c440"/><stop offset="1" stop-color="#e07a1f"/></radialGradient></defs><circle cx="18" cy="26" r="16" fill="#f6c440" opacity="0.22"/><path d="M18 8l4.4 9 9.9 1.4-7.2 7 1.7 9.8L18 30.5 9.2 35.2l1.7-9.8-7.2-7L13.6 17Z" fill="url(#g)" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>`,
    ),
  ],
};
