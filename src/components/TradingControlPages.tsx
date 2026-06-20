import {
  Activity,
  BadgePoundSterling,
  CircleDollarSign,
  Landmark,
  PieChart,
  TrendingDown,
} from "lucide-react";
import type { AuthSession, DashboardData } from "../types";
import { formatMoney, formatNumber } from "../utils/format";
import { ActualSummaryCards } from "./ActualSummaryCards";
import { BacktestResults } from "./BacktestResults";
import { ClosedTradesTable } from "./ClosedTradesTable";
import { ConfigViewer } from "./ConfigViewer";
import { DrawdownPainTracker } from "./DrawdownPainTracker";
import { ManualTrades } from "./ManualTrades";
import { OpenPositionsTable } from "./OpenPositionsTable";
import { PerformanceCards } from "./PerformanceCards";
import { PerformanceCharts } from "./PerformanceCharts";
import { RiskExposureDashboard } from "./RiskExposureDashboard";
import { ScenarioSimulator } from "./ScenarioSimulator";
import {
  NotificationHistory,
  SignalEventList,
  TodayActionPanel,
} from "./SignalEvents";
import { SignalComparison } from "./SignalComparison";
import { SettingsPage } from "./SettingsPage";
import { StrategyRules } from "./StrategyRules";
import { SummaryCards } from "./SummaryCards";
import { Badge, LiquidityBadge, SectionHeader, TierBadge, TrendBadge } from "./ui";
import { WatchlistTable } from "./WatchlistTable";
import { WealthDashboard } from "./WealthDashboard";

export type ControlPage =
  | "dashboard"
  | "signals"
  | "portfolio"
  | "performance"
  | "trade-journal"
  | "strategies"
  | "alerts"
  | "settings";

type Mutate = (
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
) => Promise<unknown>;

export function TradingControlPage({
  page,
  data,
  session,
  mutate,
  download,
  request,
}: {
  page: ControlPage;
  data: DashboardData;
  session: AuthSession;
  mutate: Mutate;
  download: (path: string, filename: string) => Promise<void>;
  request: <T>(path: string) => Promise<T>;
}) {
  if (page === "signals") {
    return <SignalsPage data={data} mutate={mutate} />;
  }
  if (page === "portfolio") {
    return <PortfolioPage data={data} mutate={mutate} />;
  }
  if (page === "performance") return <PerformancePage data={data} />;
  if (page === "trade-journal") {
    return <TradeJournalPage data={data} mutate={mutate} />;
  }
  if (page === "strategies") return <StrategiesPage data={data} />;
  if (page === "alerts") return <AlertsPage data={data} mutate={mutate} />;
  if (page === "settings") {
    return (
      <SettingsPage
        notifications={data.notifications}
        session={session}
        dataStatus={data.dataStatus}
        mutate={mutate}
        download={download}
        request={request}
      />
    );
  }
  return <ControlDashboard data={data} />;
}

function ControlDashboard({ data }: { data: DashboardData }) {
  const snapshots = [...data.wealthSnapshots.snapshots].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const latest = snapshots.at(-1);
  const scannerSnapshot = data.latestPortfolioSnapshot;
  const hasManualPortfolio = Boolean(latest);
  const hasModelPerformance =
    data.performance.closedTrades > 0 ||
    data.performance.realisedSeries.length > 0 ||
    data.openTrades.length > 0 ||
    data.closedTrades.trades.length > 0;
  const examplePortfolio =
    !scannerSnapshot && data.wealthSnapshots.isExample;
  const scannerValue = (
    value: number | null,
    fallback: number,
  ) =>
    scannerSnapshot
      ? value === null
        ? "Unavailable"
        : formatMoney(value)
      : formatMoney(fallback);
  const metrics = [
    {
      label: "Actual portfolio",
      value: scannerValue(
        scannerSnapshot?.actualPortfolioValue ?? null,
        latest?.totalPortfolioValue ?? 0,
      ),
      emptyValue: "No live portfolio data",
      detail: scannerSnapshot
        ? scannerSnapshot.actualPortfolioValue === null
          ? "Scanner placeholder · actual value unavailable"
          : "Latest canonical scanner snapshot"
        : examplePortfolio
          ? "Example snapshot · not live portfolio data"
          : "Latest private snapshot",
      icon: Landmark,
      tone: "green",
    },
    {
      label: "Model portfolio",
      value: scannerValue(
        scannerSnapshot?.modelPortfolioValue ?? null,
        data.performance.fixedStakeEquivalent,
      ),
      emptyValue: "No model data",
      detail: scannerSnapshot
        ? scannerSnapshot.modelPortfolioValue === null
          ? "Scanner placeholder · model value unavailable"
          : "Latest canonical scanner snapshot"
        : "Example model value · scanner snapshot unavailable",
      icon: CircleDollarSign,
      tone: "purple",
    },
    {
      label: "Daily P/L",
      value: scannerSnapshot
        ? scannerSnapshot.actualDailyPnl === null
          ? "Unavailable"
          : formatMoney(scannerSnapshot.actualDailyPnl)
        : formatMoney(data.dailyPL.actualDailyPL),
      emptyValue: "No calculation",
      detail: scannerSnapshot
        ? scannerSnapshot.actualDailyPnl === null
          ? "Scanner placeholder · daily P/L unavailable"
          : "Latest canonical scanner snapshot"
        : examplePortfolio
        ? "Example P/L · scanner snapshot unavailable"
        : `${data.dailyPL.actualDailyPLPercent >= 0 ? "+" : ""}${formatNumber(data.dailyPL.actualDailyPLPercent)}% adjusted for flows`,
      icon: Activity,
      tone: data.dailyPL.actualDailyPL >= 0 ? "green" : "red",
    },
    {
      label: "Total P/L",
      value: scannerSnapshot
        ? "Unavailable"
        : formatMoney(data.dailyPL.actualTotalPL),
      emptyValue: "No calculation",
      detail: scannerSnapshot
        ? "Not supplied by scanner snapshot"
        : examplePortfolio
        ? "Example total · not live portfolio data"
        : "Actual wealth less net capital",
      icon: BadgePoundSterling,
      tone: data.dailyPL.actualTotalPL >= 0 ? "green" : "red",
    },
    {
      label: "Current drawdown",
      value: scannerSnapshot
        ? scannerSnapshot.currentDrawdownPercent === null
          ? "Unavailable"
          : `${formatNumber(scannerSnapshot.currentDrawdownPercent)}%`
        : `${formatNumber(data.dailyPL.drawdownPercent)}%`,
      emptyValue: "No calculation",
      detail: scannerSnapshot
        ? scannerSnapshot.currentDrawdownPercent === null
          ? "Scanner placeholder · drawdown unavailable"
          : "Latest canonical scanner snapshot"
        : examplePortfolio
        ? "Example drawdown · not live portfolio data"
        : "From recorded portfolio peak",
      icon: TrendingDown,
      tone: data.dailyPL.drawdownPercent < -10 ? "red" : "amber",
    },
    {
      label: "Cash / invested",
      value: scannerSnapshot
        ? scannerSnapshot.cashValue === null ||
          scannerSnapshot.investedValue === null
          ? "Unavailable"
          : `${formatMoney(scannerSnapshot.cashValue)} / ${formatMoney(scannerSnapshot.investedValue)}`
        : `${formatMoney(latest?.cashBalance ?? 0)} / ${formatMoney(latest?.investedValue ?? 0)}`,
      emptyValue: "No allocation data",
      detail:
        scannerSnapshot
          ? scannerSnapshot.cashValue === null ||
            scannerSnapshot.investedValue === null
            ? "Scanner placeholder · allocation unavailable"
            : "Latest canonical scanner snapshot"
          : (latest?.totalPortfolioValue ?? 0) > 0
            ? `${formatNumber((((latest?.cashBalance ?? 0) / (latest?.totalPortfolioValue ?? 1)) * 100))}% cash`
            : examplePortfolio
              ? "Example allocation · not live portfolio data"
              : "No snapshot",
      icon: PieChart,
      tone: "blue",
    },
  ];
  const scanDate = data.scannerImport.lastGeneratedAt?.slice(0, 10);
  const todayEvents = data.signalEvents.events.filter(
    (event) => scanDate && event.occurredAt.slice(0, 10) === scanDate,
  );
  const actionable = todayEvents.filter((event) => event.isActionable);

  return (
    <div className="control-page-stack">
      <TodayActionPanel events={todayEvents} scanner={data.scannerImport} />

      <div className="control-metric-grid">
        {metrics.map(({ label, value, emptyValue, detail, icon: Icon, tone }) => {
          const hasData =
            label === "Model portfolio"
              ? Boolean(scannerSnapshot) || hasModelPerformance
              : Boolean(scannerSnapshot) || hasManualPortfolio;
          return (
            <article
              className={`control-metric control-metric--${tone}`}
              key={label}
            >
              <Icon size={18} />
              <span>{label}</span>
              <strong>{hasData ? value : emptyValue}</strong>
              <p>{hasData ? detail : "No live portfolio data recorded."}</p>
            </article>
          );
        })}
      </div>

      <section className="control-dashboard-grid">
        <div className="control-panel">
          <div className="control-panel__heading">
            <div>
              <span>Actionable signals</span>
              <h2>Verified flips only</h2>
            </div>
            <Badge tone={actionable.length ? "amber" : "green"}>
              {actionable.length}
            </Badge>
          </div>
          <SignalEventList
            events={actionable}
            deliveries={data.notifications.deliveries}
            limit={4}
            compact
            emptyCopy="No actionable entry or exit flips."
          />
        </div>

        <div className="control-panel">
          <div className="control-panel__heading">
            <div>
              <span>Current watchlist</span>
              <h2>State, not alerts</h2>
            </div>
            <Badge tone="blue">{data.watchlist.length}</Badge>
          </div>
          <CompactWatchlist items={data.watchlist.slice(0, 6)} />
        </div>
      </section>

      <section className="control-panel">
        <div className="control-panel__heading">
          <div>
            <span>Event stream</span>
            <h2>Five most recent events</h2>
          </div>
          <a href="#/signals">View all signals</a>
        </div>
        <SignalEventList
          events={data.signalEvents.events}
          deliveries={data.notifications.deliveries}
          limit={5}
          compact
        />
      </section>
    </div>
  );
}

function SignalsPage({ data, mutate }: { data: DashboardData; mutate: Mutate }) {
  const comparisonSignals = data.signalEvents.events.map((event) => ({
    id: event.eventId,
    strategyName: event.strategyName,
    title: event.signalState.replace(/_/g, " "),
    assetName: event.underlyingName,
    signalType:
      event.signalState === "actionable_entry"
        ? ("ENTRY" as const)
        : event.signalState === "actionable_exit"
          ? ("EXIT" as const)
          : ("HOLD" as const),
    underlyingTicker: event.underlyingTicker,
    tradeTicker: event.tradeTicker,
    signalDate: event.occurredAt.slice(0, 10),
    suggestedAction: event.reasonText,
    riskTier: event.riskTier,
    suggestedAllocation: `${event.allocationPercent}% · ${event.allocationStatus}`,
    liquidityWarning:
      event.signalState === "low_liquidity_warning"
        ? event.reasonText
        : null,
    referenceClose: 0,
    currency: "GBP",
    superTrendValue: 0,
    modelExitDate: null,
    modelExitPrice: null,
  }));

  return (
    <div className="control-page-stack">
      <PageHeading
        eyebrow="Signals"
        title="Canonical scanner events"
        copy="Every event includes the exact transition and triggering reason. Current trend state alone never becomes an alert."
      />
      <SignalEventList
        events={data.signalEvents.events}
        deliveries={data.notifications.deliveries}
        onAcknowledge={(event) =>
          mutate(`/signal-events/${event.eventId}/acknowledge`, "PUT", {
            acknowledged: true,
          }).then(() => undefined)
        }
      />
      <SectionHeader
        eyebrow="Decision audit"
        title="Signal versus actual"
        copy="Link canonical events to manual trades and document skipped or overridden decisions."
      />
      <SignalComparison
        signals={comparisonSignals}
        decisions={data.signalDecisions.decisions}
        trades={data.manualTrades.trades}
        assumedStake={data.settings.assumedMissedStake}
        mutate={mutate}
      />
    </div>
  );
}

function PortfolioPage({ data, mutate }: { data: DashboardData; mutate: Mutate }) {
  const hasPortfolioData =
    data.manualTrades.trades.length > 0 ||
    data.wealthSnapshots.snapshots.length > 0 ||
    data.cashFlows.cashFlows.length > 0;
  return (
    <div className="control-page-stack">
      <PageHeading
        eyebrow="Portfolio"
        title="Actual capital and risk"
        copy="Manual positions, wealth snapshots, cash flows, concentration and drawdown."
      />
      {!hasPortfolioData && (
        <div className="truthful-empty-state">
          <Landmark size={24} />
          <div>
            <h2>No live portfolio data recorded</h2>
            <p>Add a genuine snapshot, cash flow, or manual trade to begin.</p>
          </div>
        </div>
      )}
      {hasPortfolioData && (
        <ActualSummaryCards
          trades={data.manualTrades.trades}
          snapshots={data.wealthSnapshots.snapshots}
          cashFlows={data.cashFlows.cashFlows}
        />
      )}
      <WealthDashboard
        snapshots={data.wealthSnapshots.snapshots}
        cashFlows={data.cashFlows.cashFlows}
        trades={data.manualTrades.trades}
        isExample={
          data.wealthSnapshots.isExample || data.cashFlows.isExample
        }
        mutate={mutate}
      />
      {hasPortfolioData && (
        <>
          <SectionHeader
            eyebrow="Exposure"
            title="Risk concentration"
            copy="Current exposure by ticker, strategy, tier, asset class and leverage."
          />
          <RiskExposureDashboard
            trades={data.manualTrades.trades}
            snapshots={data.wealthSnapshots.snapshots}
            settings={data.settings}
          />
          <SectionHeader
            eyebrow="Drawdown"
            title="Peak-to-current pain"
            copy="Current and worst recorded drawdown with recovery requirements."
          />
          <DrawdownPainTracker snapshots={data.wealthSnapshots.snapshots} />
        </>
      )}
    </div>
  );
}

function PerformancePage({ data }: { data: DashboardData }) {
  const latest = [...data.wealthSnapshots.snapshots].sort((a, b) =>
    b.date.localeCompare(a.date),
  )[0];
  const hasPerformance =
    data.performance.closedTrades > 0 ||
    data.performance.realisedSeries.length > 0 ||
    data.openTrades.length > 0 ||
    data.closedTrades.trades.length > 0 ||
    data.config.backtests.baseline.startingCapital > 0;
  return (
    <div className="control-page-stack">
      <PageHeading
        eyebrow="Performance"
        title="Model analytics and research"
        copy="Detailed model positions, long performance history, charts, scenarios and backtests."
      />
      {!hasPerformance ? (
        <div className="truthful-empty-state">
          <Activity size={24} />
          <div>
            <h2>No model performance data imported</h2>
            <p>
              Connect a canonical scanner export before model P/L, positions,
              charts, scenarios, or backtests are shown.
            </p>
          </div>
        </div>
      ) : (
        <>
          <PerformanceCards performance={data.performance} />
          <PerformanceCharts performance={data.performance} />
          <OpenPositionsTable trades={data.openTrades} />
          <ClosedTradesTable trades={data.closedTrades.trades} />
          <SectionHeader
            eyebrow="Projection"
            title="Scenario simulator"
            copy="Assumption-based future paths; not forecasts or guarantees."
          />
          <ScenarioSimulator defaultValue={latest?.totalPortfolioValue ?? 10000} />
          <SectionHeader
            eyebrow="Research"
            title="Backtest archive"
            copy="Historical model research kept away from the decision-focused dashboard."
          />
          <BacktestResults config={data.config} />
        </>
      )}
    </div>
  );
}

function TradeJournalPage({
  data,
  mutate,
}: {
  data: DashboardData;
  mutate: Mutate;
}) {
  return (
    <div className="control-page-stack" id="manual-trades">
      <PageHeading
        eyebrow="Trade Journal"
        title="Real entries, exits and decisions"
        copy="Record fills, partial exits, fees, reasoning, emotion and system overrides."
      />
      <ManualTrades
        trades={data.manualTrades.trades}
        strategies={data.strategies.strategies}
        isExample={data.manualTrades.isExample}
        mutate={mutate}
      />
    </div>
  );
}

function StrategiesPage({ data }: { data: DashboardData }) {
  const hasStrategies =
    data.strategies.strategies.length > 0 || data.watchlist.length > 0;
  return (
    <div className="control-page-stack">
      <PageHeading
        eyebrow="Strategies"
        title="Rules, registry and current state"
        copy="Strategy definitions remain separate from user trades and canonical event history."
      />
      {!hasStrategies && (
        <div className="truthful-empty-state">
          <CircleDollarSign size={24} />
          <div>
            <h2>No strategy or watchlist data configured</h2>
            <p>
              Awaiting scanner data and genuine strategy definitions. Historical
              model results are not substituted.
            </p>
          </div>
        </div>
      )}
      {hasStrategies && (
        <div className="strategy-status-grid">
          {data.strategies.strategies.map((strategy) => (
            <article className="strategy-status-card" key={strategy.id}>
              <div>
                <Badge tone={strategy.status === "active" ? "green" : "amber"}>
                  {strategy.status}
                </Badge>
                <span>{strategy.timeframe}</span>
              </div>
              <h3>{strategy.name}</h3>
              <p>{strategy.description}</p>
              <strong>Historical quality {strategy.historicalQuality}/100</strong>
            </article>
          ))}
        </div>
      )}
      {hasStrategies && (
        <>
          <SummaryCards summary={data.summary} />
          <WatchlistTable items={data.watchlist} />
          <StrategyRules config={data.config} />
          <ConfigViewer config={data.config} />
        </>
      )}
    </div>
  );
}

function AlertsPage({
  data,
  mutate,
}: {
  data: DashboardData;
  mutate: Mutate;
}) {
  const retry = (deliveryId: string, confirmResend = false) => {
    void mutate(
      `/notifications/deliveries/${deliveryId}/retry`,
      "POST",
      { confirmResend },
    ).catch((error) =>
      window.alert(error instanceof Error ? error.message : "Retry failed."),
    );
  };

  return (
    <div className="control-page-stack">
      <PageHeading
        eyebrow="Alerts"
        title="Event and delivery history"
        copy="Alert history is the canonical signal-event stream; delivery attempts are recorded alongside it."
      />
      <SignalEventList
        events={data.signalEvents.events}
        deliveries={data.notifications.deliveries}
      />
      <SectionHeader
        eyebrow="Notifications"
        title="Delivery audit"
        copy="Provider delivery status without exposing webhook credentials."
      />
      <NotificationHistory
        deliveries={data.notifications.deliveries}
        onRetry={(deliveryId) => retry(deliveryId)}
        onResend={(deliveryId) => {
          if (
            window.confirm(
              "Re-send this already successful notification? This can create a duplicate Discord message.",
            )
          ) {
            retry(deliveryId, true);
          }
        }}
      />
    </div>
  );
}

function CompactWatchlist({
  items,
}: {
  items: DashboardData["watchlist"];
}) {
  return (
    <div className="compact-watchlist">
      {items.map((item) => (
        <article key={item.id}>
          <div>
            <strong>{item.assetName}</strong>
            <span>
              {item.entryTicker} → {item.tradeTicker}
            </span>
          </div>
          <TrendBadge trend={item.currentTrend} />
          <TierBadge tier={item.riskTier} />
          <LiquidityBadge liquidity={item.liquidityStatus} />
        </article>
      ))}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <header className="control-page-heading">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{copy}</p>
    </header>
  );
}
