import type { KeyValueStore } from "../lib/occasions";

export function browserStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const playedThisLoad = new Set<string>();
