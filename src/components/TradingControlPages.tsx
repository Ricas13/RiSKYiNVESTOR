import { Landmark } from "lucide-react";
import { useMemo, useState } from "react";
import type { AuthSession, DashboardData } from "../types";
import {
  classifySignalEventAlert,
  filterSignalEventsForAlertFilter,
  type SignalEventAlertFilter,
} from "../utils/signalEventAlerts";
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
      <SignalAuditTrail
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

type AuditTrailFilter =
  | "all"
  | "entries"
  | "exits"
  | "current-week"
  | "warnings"
  | "scanner-errors";

const auditTrailFilters: Array<{ value: AuditTrailFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "entries", label: "Entries" },
  { value: "exits", label: "Exits" },
  { value: "current-week", label: "Current week" },
  { value: "warnings", label: "Warnings" },
  { value: "scanner-errors", label: "Scanner errors" },
];

function SignalAuditTrail({
  events,
  deliveries,
  onAcknowledge,
}: {
  events: DashboardData["signalEvents"]["events"];
  deliveries: DashboardData["notifications"]["deliveries"];
  onAcknowledge: (event: DashboardData["signalEvents"]["events"][number]) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<AuditTrailFilter>("all");
  const [limit, setLimit] = useState(20);
  const filtered = useMemo(
    () => filterAuditTrailEvents(events, filter).slice(0, limit),
    [events, filter, limit],
  );
  const totalForFilter = useMemo(
    () => filterAuditTrailEvents(events, filter).length,
    [events, filter],
  );

  return (
    <section className="control-panel signal-audit-trail">
      <div className="control-panel__heading">
        <div>
          <span>Audit trail</span>
          <h2>Scanner event audit trail</h2>
          <p>
            Historical scanner events are kept for audit purposes. Current
            actions are shown on the Dashboard and Alerts page.
          </p>
        </div>
        <div className="button-row">
          <a className="button button--secondary" href="#/alerts">
            View full history in Alerts
          </a>
          <button
            type="button"
            className="button button--secondary"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Hide audit trail" : "Show audit trail"}
          </button>
        </div>
      </div>
      {!expanded ? (
        <p className="settings-note">
          Audit trail collapsed. Latest events are available on demand without
          rendering the full scanner history.
        </p>
      ) : (
        <>
          <div className="alert-filter-tabs" role="tablist" aria-label="Audit trail filters">
            {auditTrailFilters.map((item) => (
              <button
                key={item.value}
                type="button"
                className={filter === item.value ? "is-active" : ""}
                onClick={() => {
                  setFilter(item.value);
                  setLimit(20);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <SignalEventList
            events={filtered}
            deliveries={deliveries}
            emptyCopy="No matching scanner audit events."
            onAcknowledge={onAcknowledge}
          />
          {totalForFilter > filtered.length && (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setLimit((current) => current + 20)}
            >
              Show more
            </button>
          )}
        </>
      )}
    </section>
  );
}

function filterAuditTrailEvents(
  events: DashboardData["signalEvents"]["events"],
  filter: AuditTrailFilter,
) {
  const sorted = [...events].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );
  if (filter === "entries") {
    return sorted.filter((event) => event.signalState === "actionable_entry");
  }
  if (filter === "exits") {
    return sorted.filter((event) => event.signalState === "actionable_exit");
  }
  if (filter === "warnings") {
    return sorted.filter((event) =>
      ["low_liquidity_warning", "wait_review"].includes(event.signalState),
    );
  }
  if (filter === "scanner-errors") {
    return sorted.filter((event) => event.signalState === "scanner_error");
  }
  if (filter === "current-week") {
    const anchor = parseDate(sorted[0]?.occurredAt) ?? new Date();
    const weekStart = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()),
    );
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    return sorted.filter((event) => {
      const occurred = parseDate(event.occurredAt);
      return Boolean(occurred && occurred >= weekStart);
    });
  }
  return sorted;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

const alertFilters: Array<{ value: SignalEventAlertFilter; label: string }> = [
  { value: "current", label: "Current actions" },
  { value: "unacknowledged", label: "Unacknowledged" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "historical", label: "Historical" },
  { value: "scanner-errors", label: "Scanner errors" },
  { value: "delivery-failures", label: "Delivery failures" },
  { value: "all", label: "All" },
];

function emptyAlertFilterCopy(filter: SignalEventAlertFilter) {
  if (filter === "current") return "No current signal actions require review.";
  if (filter === "delivery-failures") return "No delivery failures recorded.";
  if (filter === "scanner-errors") return "No scanner errors recorded.";
  return "No matching alert history events.";
}

function AlertsPage({
  data,
  mutate,
}: {
  data: DashboardData;
  mutate: Mutate;
}) {
  const [filter, setFilter] = useState<SignalEventAlertFilter>("current");
  const alertContext = useMemo(
    () => ({
      scannerStatus: data.scannerImport.status,
      scannerGeneratedAt:
        data.scannerImport.lastGeneratedAt ??
        data.strategyMonitor.snapshot?.generatedAt ??
        null,
      deliveries: data.notifications.deliveries,
    }),
    [
      data.scannerImport.lastGeneratedAt,
      data.scannerImport.status,
      data.strategyMonitor.snapshot?.generatedAt,
      data.notifications.deliveries,
    ],
  );
  const filteredEvents = filterSignalEventsForAlertFilter(
    data.signalEvents.events,
    filter,
    alertContext,
  );
  const currentUnacknowledged = filterSignalEventsForAlertFilter(
    data.signalEvents.events,
    "current",
    alertContext,
  );
  const acknowledgeEvent = (eventId: string) =>
    mutate(`/signal-events/${eventId}/acknowledge`, "PUT", {
      acknowledged: true,
    }).then(() => undefined);
  const acknowledgeVisibleCurrent = () => {
    void Promise.all(
      currentUnacknowledged.map((event) => acknowledgeEvent(event.eventId)),
    ).catch((error) =>
      window.alert(
        error instanceof Error ? error.message : "Acknowledgement failed.",
      ),
    );
  };
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
        copy="Current actions stay separate from acknowledged and historical signal events. Nothing is deleted from the audit trail."
      />
      <section className="control-panel alerts-current-summary">
        <div className="control-panel__heading">
          <div>
            <span>Current actions</span>
            <h2>
              {currentUnacknowledged.length
                ? `${currentUnacknowledged.length} unacknowledged alert${
                    currentUnacknowledged.length === 1 ? "" : "s"
                  }`
                : "No current signal actions require review."}
            </h2>
          </div>
          <button
            className="event-acknowledge"
            disabled={!currentUnacknowledged.length}
            onClick={acknowledgeVisibleCurrent}
          >
            Acknowledge all current
          </button>
        </div>
      </section>
      <div className="alert-filter-tabs" role="tablist" aria-label="Alert filters">
        {alertFilters.map((item) => (
          <button
            key={item.value}
            type="button"
            className={filter === item.value ? "is-active" : ""}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {data.signalEvents.pagination && (
        <p className="alerts-pagination-note">
          Showing latest {data.signalEvents.pagination.returnedEvents} of{" "}
          {data.signalEvents.pagination.totalEvents} matching stored events.
          Full history remains stored; use the signalEventLimit and
          signalEventOffset query parameters for paged API reads.
        </p>
      )}
      <GroupedAlertEventList
        events={filteredEvents}
        deliveries={data.notifications.deliveries}
        emptyCopy={emptyAlertFilterCopy(filter)}
        eventMeta={(event) => classifySignalEventAlert(event, alertContext)}
        onAcknowledge={(event) => acknowledgeEvent(event.eventId)}
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

function GroupedAlertEventList({
  events,
  deliveries,
  emptyCopy,
  eventMeta,
  onAcknowledge,
}: {
  events: DashboardData["signalEvents"]["events"];
  deliveries: DashboardData["notifications"]["deliveries"];
  emptyCopy: string;
  eventMeta: (event: DashboardData["signalEvents"]["events"][number]) => ReturnType<typeof classifySignalEventAlert>;
  onAcknowledge: (event: DashboardData["signalEvents"]["events"][number]) => Promise<void>;
}) {
  if (!events.length) return <div className="empty-state">{emptyCopy}</div>;
  const groups = new Map<string, DashboardData["signalEvents"]["events"]>();
  for (const event of [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
    const key = event.occurredAt.slice(0, 10) || "Unknown date";
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return (
    <div className="alerts-date-groups">
      {[...groups.entries()].map(([date, group]) => (
        <section className="alerts-date-group" key={date}>
          <h3>{date}</h3>
          <SignalEventList
            events={group}
            deliveries={deliveries}
            eventMeta={eventMeta}
            onAcknowledge={onAcknowledge}
          />
        </section>
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
