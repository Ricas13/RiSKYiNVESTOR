import {
  ArrowDown,
  ArrowUp,
  BadgePoundSterling,
  CalendarRange,
  Check,
  CircleOff,
  Percent,
  RouteOff,
  Target,
  Trophy,
} from "lucide-react";
import type { SiteConfig } from "../types";
import { formatMoney, formatNumber } from "../utils/format";
import { Badge } from "./ui";

export function BacktestResults({ config }: { config: SiteConfig }) {
  const backtest = config.backtests.baseline;
  const stats = [
    {
      label: "Starting capital",
      value: formatMoney(backtest.startingCapital),
      icon: BadgePoundSterling,
    },
    {
      label: "Final equity",
      value: formatMoney(backtest.finalEquity),
      icon: Trophy,
      featured: true,
    },
    {
      label: "Total return",
      value: `+${formatNumber(backtest.totalReturn)}%`,
      icon: ArrowUp,
      featured: true,
    },
    {
      label: "CAGR",
      value: `+${formatNumber(backtest.cagr)}%`,
      icon: CalendarRange,
    },
    {
      label: "Max drawdown",
      value: `${formatNumber(backtest.maxDrawdown)}%`,
      icon: ArrowDown,
      danger: true,
    },
    {
      label: "Closed trades",
      value: backtest.closedTrades.toString(),
      icon: Check,
    },
    {
      label: "Skipped signals",
      value: backtest.skippedSignals.toString(),
      icon: RouteOff,
    },
    {
      label: "Average trade",
      value: `+${formatNumber(backtest.averageTrade)}%`,
      icon: Target,
    },
    {
      label: "Median trade",
      value: `+${formatNumber(backtest.medianTrade)}%`,
      icon: Percent,
    },
    {
      label: "Win rate",
      value: `${formatNumber(backtest.winRate, 1)}%`,
      icon: Percent,
    },
  ];

  return (
    <div className="backtest-stack">
      <div className="backtest-hero">
        <div className="backtest-hero__copy">
          <Badge tone="green">CURRENT BASELINE</Badge>
          <h3>{backtest.title}</h3>
          <p>
            CORE + AGGRESSIVE instruments only. Historical simulation results are
            illustrative and do not include future slippage, spread changes, tax, or
            execution differences.
          </p>
        </div>
        <div className="backtest-return">
          <span>Model equity multiple</span>
          <strong>{(backtest.finalEquity / backtest.startingCapital).toFixed(1)}×</strong>
          <small>on starting capital</small>
        </div>
      </div>

      <div className="backtest-grid">
        {stats.map(({ label, value, icon: Icon, featured, danger }) => (
          <article
            className={`backtest-stat ${featured ? "backtest-stat--featured" : ""} ${
              danger ? "backtest-stat--danger" : ""
            }`}
            key={label}
          >
            <Icon size={17} />
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="secondary-tests">
        <div className="panel-title-row">
          <div>
            <span>Research log</span>
            <h3>Rejected and secondary tests</h3>
          </div>
        </div>
        <div className="secondary-test-grid">
          {config.backtests.secondaryTests.map((test) => (
            <article key={test.name}>
              <div>
                <CircleOff size={18} />
                <Badge tone={test.status === "Rejected" ? "red" : "amber"}>
                  {test.status}
                </Badge>
              </div>
              <h4>{test.name}</h4>
              {test.stats && (
                <dl>
                  {Object.entries(test.stats).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}%</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p>{test.notes}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
