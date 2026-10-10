/**
 * Classes for a bordered card, a shade lighter than the page; `selected` adds
 * a charcoal outline, `tentative` a dashed one for something not yet settled.
 * A class helper rather than a component, because cards are buttons, list
 * items and plain boxes.
 */
export function cardClass({
  selected = false,
  tentative = false,
}: { selected?: boolean; tentative?: boolean } = {}) {
  const edge = selected
    ? "border-ink ring-1 ring-ink"
    : tentative
      ? "border-dashed border-line-strong"
      : "border-line";
  return `rounded-lg border bg-card ${edge}`;
}
