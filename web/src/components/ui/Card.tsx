/**
 * Classes for a bordered card, a shade lighter than the page; `selected` adds
 * a charcoal outline.
 * A class helper rather than a component, because cards are buttons, list
 * items and plain boxes.
 */
export function cardClass({ selected = false }: { selected?: boolean } = {}) {
  return `rounded-lg border bg-card ${selected ? "border-ink ring-1 ring-ink" : "border-line"}`;
}
