import { Landmark } from "lucide-react";
import type { AuthSession, DashboardData } from "../types";
import { ActualSummaryCards } from "./ActualSummaryCards";
import { ClosedTradesTable } from "./ClosedTradesTable";
import { DashboardCommandCentre } from "./DashboardCommandCentre";
import { DrawdownPainTracker } from "./DrawdownPainTracker";
import { ManualTrades } from "./ManualTrades";
import { OpenPositionsTable } from "./OpenPositionsTable";
import { PerformanceCards } from "./PerformanceCards";
import { PerformanceCharts } from "./PerformanceCharts";
import { RiskExposureDashboard } from "./RiskExposureDashboard";
import { ScannerSignalMonitor } from "./ScannerSignalMonitor";
import { NotificationHistory, SignalEventList } from "./SignalEvents";
import { SignalComparison } from "./SignalComparison";
import { SettingsPage } from "./SettingsPage";
import { StrategyMonitor } from "./StrategyMonitor";
import { SectionHeader } from "./ui";
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
  if (page === "strategies") {
    return (
      <StrategyMonitor
        monitor={data.strategyMonitor}
        refresh={() => mutate("/scanner/refresh", "POST")}
        canRefresh={session.role === "owner" || session.role === "admin"}
      />
    );
  }
  if (page === "alerts") return <AlertsPage data={data} mutate={mutate} />;
  if (page === "settings") {
    return (
      <SettingsPage
        notifications={data.notifications}
        strategyConfiguration={data.strategyConfiguration}
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
  return (
    <div className="control-page-stack control-room-page dashboard-page-stack">
      <PageHeading
        eyebrow="Dashboard"
        title="Signal control room"
        copy="Daily command centre for scanner health, recent signal changes, current model positions and manual action review."
      />
      <DashboardCommandCentre data={data} />
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
    <div className="control-page-stack control-room-page signal-monitor-page">
      <PageHeading
        eyebrow="Signal Monitor"
        title="Ticker-pair signal control table"
        copy="Review current SuperTrend ticker-pair status, weekly reversals, open virtual positions and scanner freshness from the latest scanner snapshot."
      />
      <ScannerSignalMonitor monitor={data.strategyMonitor} />
      <SectionHeader
        eyebrow="Recent signal events"
        title="Event stream"
        copy="Canonical scanner events remain available below the ticker-pair table for audit and acknowledgement."
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
        eyebrow="Historical records"
        title="Secondary capital and risk records"
        copy="Legacy portfolio snapshots and exposure notes are kept here for history, away from the primary signal workflow."
      />
      {!hasPortfolioData && (
        <div className="truthful-empty-state">
          <Landmark size={24} />
          <div>
            <h2>No historical capital records</h2>
            <p>
              Record manual trades from signals first; capital snapshots are
              optional.
            </p>
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
        isExample={data.wealthSnapshots.isExample || data.cashFlows.isExample}
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
  const hasLegacyActualPerformance =
    data.performance.closedTrades > 0 ||
    data.performance.realisedSeries.length > 0 ||
    data.openTrades.length > 0 ||
    data.closedTrades.trades.length > 0;
  return (
    <div className="control-page-stack control-room-page strategy-performance-page">
      <PageHeading
        eyebrow="Strategy Performance"
        title="Model and actual signal performance"
        copy="Compare SuperTrend and SMA200 model behaviour, actual trade outcomes, equity curves and closed model trades."
      />
      <section className="model-performance-note">
        <article>
          <span>Model performance</span>
          <p>
            Model performance is based on scanner virtual trades. It is not
            broker-synced.
          </p>
        </article>
        <article>
          <span>Actual trading progress</span>
          <p>
            Actual trading progress is based only on trades you manually
            recorded.
          </p>
        </article>
      </section>
      <StrategyMonitor monitor={data.strategyMonitor} showHeading={false} />
      {hasLegacyActualPerformance && (
        <details className="legacy-performance-details">
          <summary>Historical actual trade performance records</summary>
          <div>
            <PerformanceCards performance={data.performance} />
            <PerformanceCharts performance={data.performance} />
            <OpenPositionsTable trades={data.openTrades} />
            <ClosedTradesTable trades={data.closedTrades.trades} />
          </div>
        </details>
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
    <div
      className="control-page-stack control-room-page trade-journal-page"
      id="manual-trades"
    >
      <PageHeading
        eyebrow="Trade Journal"
        title="Manual trades taken from signals"
        copy="Record the buys and sells you actually place after reviewing SuperTrend, SMA200 or manual signals."
      />
      <ManualTrades
        trades={data.manualTrades.trades}
        strategyMonitor={data.strategyMonitor}
        isExample={data.manualTrades.isExample}
        mutate={mutate}
      />
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
    <div className="control-page-stack control-room-page alerts-page">
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
