import { decorationSvg } from "../decorations";
import type { DecorationId } from "../types";

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function decorationUrl(id: DecorationId): string {
  return `data:image/svg+xml,${encodeURIComponent(decorationSvg(id))}`;
}

export function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
