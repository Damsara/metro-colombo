import type { ButtonHTMLAttributes, Ref } from "react";

type ButtonVariant =
  | "primary"
  | "bus"
  | "secondary"
  | "neutral"
  | "quiet"
  | "link";
type ButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-ink bg-ink text-white",
  bus: "border border-bus bg-bus text-white",
  secondary: "border border-line-strong bg-card text-ink",
  neutral: "border border-line bg-card text-ink",
  quiet: "text-ink",
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
  pill?: boolean;
  block?: boolean;
  align?: "center" | "start";
}

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
      : `${pill ? "rounded-full" : "rounded-md"} ${variant === "quiet" ? "min-h-11 min-w-11 px-2 text-sm" : SIZES[size]}`;
  return [
    "inline-flex items-center gap-2 font-semibold",
    align === "start"
      ? "justify-start [&>svg:last-child]:ml-auto"
      : "justify-center",
    "disabled:cursor-not-allowed aria-disabled:cursor-progress aria-disabled:opacity-50",
    // A disabled filled button turns flat and grey rather than fading, so its label stays readable.
    variant === "primary" || variant === "bus"
      ? "disabled:border-line-strong disabled:bg-field disabled:text-muted disabled:opacity-100"
      : "disabled:opacity-50",
    VARIANTS[variant],
    shape,
    block ? "w-full" : "",
  ].join(" ");
}

/** `className` is for layout only (margins, flex sizing); appearance comes from the props. */
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
