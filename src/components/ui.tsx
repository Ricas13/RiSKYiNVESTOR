import type { ReactNode } from "react";
import type { Liquidity, RiskTier, Trend } from "../types";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "green" | "red" | "amber" | "neutral" | "blue" | "purple";
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function TierBadge({ tier }: { tier: RiskTier }) {
  const tone =
    tier === "CORE"
      ? "green"
      : tier === "AGGRESSIVE"
        ? "amber"
        : tier === "SPECULATIVE"
          ? "purple"
          : "neutral";
  return <Badge tone={tone}>{tier}</Badge>;
}

export function TrendBadge({ trend }: { trend: Trend }) {
  return (
    <Badge
      tone={trend === "Green" ? "green" : trend === "Red" ? "red" : "neutral"}
    >
      <span className="status-dot" aria-hidden="true" />
      {trend}
    </Badge>
  );
}

export function LiquidityBadge({ liquidity }: { liquidity: Liquidity }) {
  return (
    <Badge
      tone={
        liquidity === "Good" ? "green" : liquidity === "Moderate" ? "amber" : "red"
      }
    >
      {liquidity} liquidity
    </Badge>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="section-copy">{copy}</p>
      </div>
      {action}
    </div>
  );
}

export function ExpandableRowsControls({
  expanded,
  hasOverflow,
  totalRows,
  visibleCount,
  onToggle,
  expandLabel = "Show more",
  collapseLabel = "Collapse",
}: {
  expanded: boolean;
  hasOverflow: boolean;
  totalRows: number;
  visibleCount: number;
  onToggle: () => void;
  expandLabel?: string;
  collapseLabel?: string;
}) {
  if (!hasOverflow) return null;
  return (
    <div className="expandable-rows__controls">
      <span>Showing {visibleCount} of {totalRows}</span>
      <button
        type="button"
        className="button button--secondary"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {expanded ? collapseLabel : expandLabel}
      </button>
    </div>
  );
}
