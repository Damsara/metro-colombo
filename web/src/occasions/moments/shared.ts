import { decorationImages } from "../decorations";
import type { DecorationId } from "../types";

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function decorationUrl(id: DecorationId, index = 0): string {
  const images = decorationImages(id);
  return images[index % images.length];
}

export function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
