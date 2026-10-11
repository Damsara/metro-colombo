import type { Crowding } from "../types";

export type Bounce = {
  lift: number;
  squash: number;
  grow: number;
  rock: number;
  wiggle: number;
};

const STILL: Bounce = { lift: 0, squash: 0, grow: 1, rock: 0, wiggle: 0 };

// Lift in model metres; squash is the share of height lost on landing; grow
// swells the bus at the top of a hop, which is what shows when seen from above.
const STYLE: Record<
  Exclude<Crowding, "roomy">,
  {
    lift: number;
    periodMs: number;
    squash: number;
    grow: number;
    rock: number;
    wiggle: number;
  }
> = {
  filling: {
    lift: 1,
    periodMs: 1100,
    squash: 0.06,
    grow: 0.05,
    rock: 0.02,
    wiggle: 0.03,
  },
  crowded: {
    lift: 3,
    periodMs: 650,
    squash: 0.18,
    grow: 0.14,
    rock: 0.06,
    wiggle: 0.08,
  },
};

export function busBounce(
  crowding: Crowding | null,
  now: number,
  offset: number,
): Bounce {
  if (crowding === null || crowding === "roomy") return STILL;
  const style = STYLE[crowding];
  const phase = (((now / style.periodMs + offset) % 1) + 1) % 1;
  const air = Math.sin(Math.PI * phase);
  return {
    lift: style.lift * air,
    squash: style.squash * ((1 - air) ** 4 - 0.5 * air),
    grow: 1 + style.grow * air,
    rock: style.rock * Math.sin(2 * Math.PI * phase),
    wiggle: style.wiggle * Math.sin(2 * Math.PI * phase),
  };
}

export function bounceOffset(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 2 ** 32;
}
