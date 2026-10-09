/**
 * Classes for a bordered white surface; `selected` adds the green outline.
 * A class helper rather than a component, because cards are buttons, list
 * items and plain boxes.
 */
export function cardClass({ selected = false }: { selected?: boolean } = {}) {
  return `rounded-lg border bg-white ${selected ? "border-green ring-1 ring-green" : "border-line"}`;
}
