import type { DecorationId } from "./types";

const OUTLINE = "#8f6200";

const SHAPES: Record<DecorationId, string> = {
  lantern: `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6d0"/><stop offset="0.55" stop-color="#f6c440"/><stop offset="1" stop-color="#e07a1f"/></linearGradient></defs><path d="M18 1v7" stroke="${OUTLINE}" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M18 8 31 19 26 42H10L5 19Z" fill="url(#g)" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/><path d="M18 8v34M5 19h26" stroke="${OUTLINE}" stroke-width="0.8" opacity="0.5"/>`,
  oilLamp: `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6d0"/><stop offset="0.5" stop-color="#f6c440"/><stop offset="1" stop-color="#e07a1f"/></linearGradient></defs><path d="M18 3C23 10 25 16 25 21a7 7 0 0 1-14 0c0-5 2-11 7-18Z" fill="url(#g)" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/><path d="M4 28h28c0 8-6 14-14 14S4 36 4 28Z" fill="#b4542a" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>`,
  star: `<defs><radialGradient id="g" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6d0"/><stop offset="0.6" stop-color="#f6c440"/><stop offset="1" stop-color="#e07a1f"/></radialGradient></defs><circle cx="18" cy="26" r="16" fill="#f6c440" opacity="0.22"/><path d="M18 8l4.4 9 9.9 1.4-7.2 7 1.7 9.8L18 30.5 9.2 35.2l1.7-9.8-7.2-7L13.6 17Z" fill="url(#g)" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>`,
};

export function decorationSvg(id: DecorationId): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">${SHAPES[id]}</svg>`;
}
