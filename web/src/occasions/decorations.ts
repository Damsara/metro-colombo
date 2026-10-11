import type { DecorationId } from "./types";

export function decorationSvg(id: DecorationId): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" data-id="${id}"><circle cx="18" cy="22" r="10" fill="#f6c440"/></svg>`;
}
