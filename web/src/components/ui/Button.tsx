import type { ButtonHTMLAttributes, Ref } from "react";

type ButtonVariant = "primary" | "secondary" | "neutral" | "quiet" | "link";
type ButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-brand bg-brand text-white",
  secondary: "border border-line-strong bg-white text-ink",
  neutral: "border border-line bg-white text-ink",
  // Text-only actions inside panels, e.g. "Use my location".
  quiet: "text-ink",
  // Inline actions inside a sentence or notice.
  link: "min-h-6 font-semibold text-inherit underline",
};

const SIZES: Record<ButtonSize, string> = {
  // Compact controls inside floating cards; the touch target extends to 44px.
  xs: "relative min-h-8 px-3 text-xs after:absolute after:inset-x-0 after:-inset-y-1.5",
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-12 px-4 text-base",
  lg: "min-h-13 px-5 text-base",
};

interface ButtonStyle {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Rounded ends, for floating controls over the map. */
  pill?: boolean;
  /** Stretch to the container's width. */
  block?: boolean;
  /** Content alignment; icons after the label are pushed to the end. */
  align?: "center" | "start";
}

/** Classes for a button-styled element, e.g. a router link. */
export function buttonClass({
  variant = "secondary",
  size = "md",
  pill = false,
  block = false,
  align = "center",
}: ButtonStyle = {}): string {
  const shape =
    variant === "link"
      ? ""
      : `${pill ? "rounded-full" : "rounded-md"} ${variant === "quiet" ? "min-h-11 text-sm" : SIZES[size]}`;
  return [
    "inline-flex items-center gap-2 font-semibold",
    align === "start"
      ? "justify-start [&>svg:last-child]:ml-auto"
      : "justify-center",
    "disabled:cursor-not-allowed aria-disabled:cursor-progress aria-disabled:opacity-50",
    // A disabled main action turns grey rather than a faded red, which reads
    // as an error.
    variant === "primary"
      ? "disabled:border-line-strong disabled:bg-tint-200 disabled:text-muted"
      : "disabled:opacity-50",
    VARIANTS[variant],
    shape,
    block ? "w-full" : "",
  ].join(" ");
}

/**
 * The app's button. `className` is for layout only (margins, flex sizing);
 * appearance comes from the props so every button stays consistent.
 */
export function Button({
  variant,
  size,
  pill,
  block,
  align,
  className = "",
  type = "button",
  ...props
}: ButtonStyle &
  ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      type={type}
      className={`${buttonClass({ variant, size, pill, block, align })} ${className}`}
      {...props}
    />
  );
}
