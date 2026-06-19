import {
  Banknote,
  CircleAlert,
  Cpu,
  Gauge,
  Layers3,
  ShieldAlert,
  WalletCards,
  Zap,
} from "lucide-react";
import type {
  DashboardSettings,
  ManualTrade,
  WealthSnapshot,
} from "../types";
import { formatMoney, formatNumber } from "../utils/format";
import { calculateTrade } from "../utils/manualTrades";
import { Badge } from "./ui";

interface Exposure {
  name: string;
  value: number;
}

export function RiskExposureDashboard({
  trades,
  snapshots,
  settings,
}: {
  trades: ManualTrade[];
  snapshots: WealthSnapshot[];
  settings: DashboardSettings;
}) {
  const latest = [...snapshots].sort((a, b) => b.date.localeCompare(a.date))[0];
  const portfolioValue = latest?.totalPortfolioValue ?? 0;
  const cash = latest?.cashBalance ?? 0;
  const open = trades
    .map((trade) => ({ trade, result: calculateTrade(trade) }))
    .filter((item) => item.result.quantityRemaining > 0);
  const invested = open.reduce(
    (sum, item) => sum + item.result.openPositionValue,
    0,
  );
  const denominator = portfolioValue || invested + cash || 1;

  const byTicker = group(open, (item) => item.trade.ticker);
  const byStrategy = group(open, (item) => item.trade.strategyName);
  const byTier = group(open, (item) => item.trade.riskTier ?? "CORE");
  const byAssetClass = group(open, (item) => item.trade.assetClass ?? "Other");
  const technology = open
    .filter((item) => item.trade.isTechnology)
    .reduce((sum, item) => sum + item.result.openPositionValue, 0);
  const singleStock = open
    .filter((item) => item.trade.isSingleStock)
    .reduce((sum, item) => sum + item.result.openPositionValue, 0);
  const leveraged = open
    .filter((item) => (item.trade.leverageMultiplier ?? 1) >= 3)
    .reduce((sum, item) => sum + item.result.openPositionValue, 0);
  const speculative = open
    .filter((item) => item.trade.riskTier === "SPECULATIVE")
    .reduce((sum, item) => sum + item.result.openPositionValue, 0);
  const cashPct = (cash / denominator) * 100;
  const technologyPct = (technology / denominator) * 100;
  const leveragedPct = (leveraged / denominator) * 100;
  const speculativePct = (speculative / denominator) * 100;
  const largestTicker = byTicker[0];
  const largestTickerPct = ((largestTicker?.value ?? 0) / denominator) * 100;
  const sortedSnapshots = [...snapshots].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const peak = Math.max(
    0,
    ...sortedSnapshots.map((snapshot) => snapshot.totalPortfolioValue),
  );
  const currentDrawdown =
    peak > 0 && latest
      ? ((latest.totalPortfolioValue - peak) / peak) * 100
      : 0;

  const warnings = [
    largestTickerPct > settings.riskLimits.maxTickerPct
      ? `Over-concentrated in ${largestTicker?.name}: ${formatNumber(largestTickerPct)}%.`
      : null,
    technologyPct > settings.riskLimits.maxTechnologyPct
      ? `Technology exposure is ${formatNumber(technologyPct)}%.`
      : null,
    speculativePct > settings.riskLimits.maxSpeculativePct
      ? `Speculative exposure is ${formatNumber(speculativePct)}%.`
      : null,
    leveragedPct > settings.riskLimits.maxLeveraged3xPct
      ? `3× leveraged exposure is ${formatNumber(leveragedPct)}%.`
      : null,
    cashPct < settings.riskLimits.minimumCashPct
      ? `Cash buffer is only ${formatNumber(cashPct)}%.`
      : null,
    Math.abs(currentDrawdown) >= settings.riskLimits.elevatedDrawdownPct
      ? `Drawdown risk is elevated at ${formatNumber(currentDrawdown)}%.`
      : null,
  ].filter(Boolean) as string[];

  return (
    <div className="risk-exposure-stack">
      <div className="risk-stat-grid">
        <RiskStat icon={Gauge} label="Total invested" value={formatMoney(invested)} />
        <RiskStat icon={Banknote} label="Cash available" value={formatMoney(cash)} />
        <RiskStat icon={Cpu} label="Technology" value={`${formatNumber(technologyPct)}%`} />
        <RiskStat icon={Layers3} label="Single stocks" value={`${formatNumber((singleStock / denominator) * 100)}%`} />
        <RiskStat icon={Zap} label="3× leveraged" value={`${formatNumber(leveragedPct)}%`} />
        <RiskStat icon={WalletCards} label="Cash percentage" value={`${formatNumber(cashPct)}%`} />
      </div>

      <div className={`risk-warning-panel ${warnings.length ? "risk-warning-panel--active" : ""}`}>
        <ShieldAlert size={21} />
        <div>
          <strong>{warnings.length ? `${warnings.length} exposure warning${warnings.length === 1 ? "" : "s"}` : "Exposure checks are within configured limits"}</strong>
          {warnings.length ? (
            <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          ) : (
            <p>Keep checking liquidity, correlations, and real executable prices.</p>
          )}
        </div>
      </div>

      <div className="exposure-grid">
        <ExposurePanel title="Exposure by ticker" items={byTicker} total={denominator} />
        <ExposurePanel title="Exposure by strategy" items={byStrategy} total={denominator} />
        <ExposurePanel title="Exposure by risk tier" items={byTier} total={denominator} />
        <ExposurePanel title="Exposure by asset class" items={byAssetClass} total={denominator} />
      </div>

      <div className="risk-method-note">
        <CircleAlert size={15} />
        Exposure uses manually entered current prices and the latest wealth snapshot. It is a monitoring aid, not a broker statement.
      </div>
    </div>
  );
}

function group(
  rows: Array<{ trade: ManualTrade; result: ReturnType<typeof calculateTrade> }>,
  key: (row: { trade: ManualTrade; result: ReturnType<typeof calculateTrade> }) => string,
) {
  const values = new Map<string, number>();
  rows.forEach((row) =>
    values.set(key(row), (values.get(key(row)) ?? 0) + row.result.openPositionValue),
  );
  return [...values.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function RiskStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}) {
  return (
    <article className="risk-stat">
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ExposurePanel({
  title,
  items,
  total,
}: {
  title: string;
  items: Exposure[];
  total: number;
}) {
  return (
    <article className="exposure-panel panel">
      <div className="panel-title-row">
        <div><span>Current portfolio</span><h3>{title}</h3></div>
        <Badge tone="blue">{items.length}</Badge>
      </div>
      <div className="exposure-list">
        {items.map((item) => {
          const percentage = (item.value / total) * 100;
          return (
            <div key={item.name}>
              <div><strong>{item.name}</strong><span>{formatMoney(item.value)} · {formatNumber(percentage)}%</span></div>
              <i><b style={{ width: `${Math.min(100, percentage)}%` }} /></i>
            </div>
          );
        })}
        {!items.length && <p className="empty-state">No open exposure recorded.</p>}
      </div>
    </article>
  );
}
