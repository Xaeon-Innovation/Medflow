import { type HTMLAttributes } from "react";
import type { NoShowRiskLevel } from "@/types";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "success" | "warning" | "destructive";
  /** Use for no-show risk: LOW / MEDIUM / HIGH */
  risk?: NoShowRiskLevel;
}

export function Badge({
  className = "",
  variant = "default",
  risk,
  children,
  ...props
}: BadgeProps) {
  const v = risk ? riskToVariant(risk) ?? "default" : variant ?? "default";
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  const variants = {
    default: "bg-primary/10 text-primary border border-primary/20",
    secondary: "bg-muted text-muted-foreground",
    success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    destructive: "bg-destructive/15 text-destructive",
  };
  return (
    <span
      className={`${base} ${variants[v]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

function riskToVariant(risk: NoShowRiskLevel): BadgeProps["variant"] {
  switch (risk) {
    case "LOW":
      return "success";
    case "MEDIUM":
      return "warning";
    case "HIGH":
      return "destructive";
    default:
      return "default";
  }
}
