import {
  BadgePoundSterling,
  Percent,
  Scale,
  Trophy,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type { Performance } from "../types";
import { formatMoney } from "../utils/format";

export function PerformanceCards({ performance }: { performance: Performance }) {
  const cards = [
    {
      label: "Realised model P/L",
      value: `+${performance.realisedModelPL.toFixed(1)}%`,
      icon: TrendingUp,
    },
    {
      label: "Average closed trade",
      value: `+${performance.averageClosedTrade.toFixed(1)}%`,
      icon: Trophy,
    },
    {
      label: "Median closed trade",
      value: `${performance.medianClosedTrade >= 0 ? "+" : ""}${performance.medianClosedTrade.toFixed(1)}%`,
      icon: Scale,
    },
    {
      label: "Win rate",
      value: `${performance.winRate.toFixed(1)}%`,
      icon: Percent,
    },
    {
      label: "Closed trades",
      value: performance.closedTrades.toString(),
      icon: WalletCards,
    },
    {
      label: "£1k fixed-stake equivalent",
      value: formatMoney(performance.fixedStakeEquivalent),
      icon: BadgePoundSterling,
    },
  ];

  return (
    <div className="performance-card-grid">
      {cards.map(({ label, value, icon: Icon }) => (
        <article className="performance-card" key={label}>
          <Icon size={18} />
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </div>
  );
}
