import type { ButtonHTMLAttributes } from "react";

const VARIANTS = {
  outline: "border border-line bg-card",
  tinted: "border border-line bg-tint-50",
  soft: "bg-tint-100",
  plain: "bg-transparent",
};

const SIZES = {
  md: "size-11",
  // Compact, inside floating cards; the touch target still covers 44px.
  sm: "relative size-8 after:absolute after:-inset-1.5",
};

export function IconButton({
  label,
  variant = "outline",
  size = "md",
  className = "",
  type = "button",
  ...props
}: {
  label: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`grid shrink-0 place-items-center rounded-full ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
