import {
  BadgePoundSterling,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  Landmark,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type { CashFlow, ManualTrade, WealthSnapshot } from "../types";
import { formatMoney } from "../utils/format";
import { calculateTrade } from "../utils/manualTrades";

export function ActualSummaryCards({
  trades,
  snapshots,
  cashFlows,
}: {
  trades: ManualTrade[];
  snapshots: WealthSnapshot[];
  cashFlows: CashFlow[];
}) {
  const latest = [...snapshots].sort((a, b) => b.date.localeCompare(a.date))[0];
  const calculations = trades.map(calculateTrade);
  const realised = calculations.reduce((sum, item) => sum + item.realisedPL, 0);
  const unrealised = calculations.reduce(
    (sum, item) => sum + item.unrealisedPL,
    0,
  );
  const netDeposits = cashFlows.reduce(
    (sum, flow) => sum + (flow.type === "deposit" ? flow.amount : -flow.amount),
    0,
  );
  const cards = [
    {
      label: "Actual portfolio value",
      value: formatMoney(latest?.totalPortfolioValue ?? 0),
      detail: "Latest manual wealth snapshot",
      icon: Landmark,
    },
    {
      label: "Actual open positions",
      value: calculations.filter((item) => item.quantityRemaining > 0).length.toString(),
      detail: "Real entries still open",
      icon: BriefcaseBusiness,
    },
    {
      label: "Actual realised P/L",
      value: formatMoney(realised),
      detail: "From recorded exits",
      icon: BadgePoundSterling,
    },
    {
      label: "Actual unrealised P/L",
      value: formatMoney(unrealised),
      detail: "Using manual current prices",
      icon: TrendingUp,
    },
    {
      label: "Net invested capital",
      value: formatMoney(netDeposits),
      detail: "Deposits less withdrawals",
      icon: WalletCards,
    },
    {
      label: "Separation status",
      value: "Actual",
      detail: "Never mixed with model results",
      icon: ChartNoAxesCombined,
    },
  ];

  return (
    <div className="summary-grid actual-summary-grid">
      {cards.map(({ label, value, detail, icon: Icon }) => (
        <article className="metric-card metric-card--blue" key={label}>
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
