import type { ReactNode } from "react";

const TONES = {
  neutral: "border-line bg-tint-50 text-muted [&_svg]:text-muted",
  warning: "border-warning-200 bg-warning-50 text-ink [&_svg]:text-warning",
  danger: "border-danger-200 bg-danger-50 text-danger [&_svg]:text-danger",
};

/**
 * A message about the state of the page: an error, a warning, or an empty or
 * loading result. Announced to screen readers through `role`.
 */
export function Notice({
  tone = "neutral",
  icon,
  title,
  action,
  role = "status",
  className = "",
  children,
}: {
  tone?: keyof typeof TONES;
  icon?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  role?: "status" | "alert";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={role}
      aria-live={role === "status" ? "polite" : undefined}
      className={`rounded-md border p-4 text-md leading-relaxed ${TONES[tone]} ${className}`}
    >
      {icon && <div className="mb-3">{icon}</div>}
      {title && <h3 className="mb-2 text-xl text-ink">{title}</h3>}
      {children && <div>{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
