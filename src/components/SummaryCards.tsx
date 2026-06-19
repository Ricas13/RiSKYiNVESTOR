import {
  ArrowDownRight,
  ArrowUpRight,
  BadgePoundSterling,
  CircleDot,
  Layers3,
  RadioTower,
} from "lucide-react";
import type { Summary } from "../types";
import { formatMoney } from "../utils/format";

export function SummaryCards({ summary }: { summary: Summary }) {
  const cards = [
    {
      label: "Market breadth",
      value: `${summary.greenTickers} / ${summary.greenTickers + summary.redTickers}`,
      detail: `${summary.greenTickers} green · ${summary.redTickers} red`,
      icon: CircleDot,
      tone: "green",
    },
    {
      label: "Entry signals",
      value: summary.entrySignalsToday.toString().padStart(2, "0"),
      detail: "New underlying flips today",
      icon: ArrowUpRight,
      tone: "green",
    },
    {
      label: "Exit signals",
      value: summary.exitSignalsToday.toString().padStart(2, "0"),
      detail: "Leveraged ticker exits today",
      icon: ArrowDownRight,
      tone: "red",
    },
    {
      label: "Open model trades",
      value: summary.openModelTrades.toString().padStart(2, "0"),
      detail: "Reference-close tracking",
      icon: Layers3,
      tone: "blue",
    },
    {
      label: "Realised model P/L",
      value: `${summary.realisedModelPL >= 0 ? "+" : ""}${summary.realisedModelPL.toFixed(1)}%`,
      detail: `${formatMoney(1000 * (1 + summary.realisedModelPL / 100))} from £1k equivalent`,
      icon: BadgePoundSterling,
      tone: summary.realisedModelPL >= 0 ? "green" : "red",
    },
    {
      label: "Data status",
      value: summary.dataStatus,
      detail: "Local JSON export",
      icon: RadioTower,
      tone: "purple",
    },
  ];

  return (
    <div className="summary-grid">
      {cards.map(({ label, value, detail, icon: Icon, tone }) => (
        <article className={`metric-card metric-card--${tone}`} key={label}>
          <div className="metric-card__top">
            <span>{label}</span>
            <span className="metric-icon">
              <Icon size={18} />
            </span>
          </div>
          <strong>{value}</strong>
          <p>{detail}</p>
        </article>
      ))}
    </div>
  );
}
