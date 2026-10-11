export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
