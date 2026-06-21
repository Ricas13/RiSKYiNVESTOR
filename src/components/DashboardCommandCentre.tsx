import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ShieldAlert,
} from "lucide-react";
import * as React from "react";
import type { DashboardData } from "../types";
import {
  buildDashboardCommandCentreModel,
  type DashboardActionItem,
  type DashboardActionType,
} from "../utils/dashboardCommandCentre";
import { formatDateTime, formatMoney, formatNumber } from "../utils/format";
import { SignalEventList } from "./SignalEvents";
import { Badge, SectionHeader } from "./ui";

export function DashboardCommandCentre({ data }: { data: DashboardData }) {
  const model = buildDashboardCommandCentreModel(data);

  if (!model.hasScannerSnapshot && model.scanner.status === "awaiting") {
    return (
      <>
        <ScannerHealthStrip model={model} />
        <div className="truthful-empty-state">
          <ShieldAlert size={24} />
          <div>
            <h2>Awaiting scanner data</h2>
            <p>
              The dashboard will become a signal command centre after the first
              valid multi-strategy scanner snapshot is imported.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ScannerHealthStrip model={model} />
      <ActionNeededPanel items={model.actionItems} />
      <CurrentModelPositionsPanel positions={model.currentModelPositions} />
      <section className="dashboard-command-grid">
        <SuperTrendSummaryCard summary={model.superTrend} />
        <Sma200SummaryCard summary={model.sma200} />
      </section>
      <section className="control-panel">
        <div className="control-panel__heading">
          <div>
            <span>Recent signal history</span>
            <h2>Scanner event stream</h2>
          </div>
          <a href="#/signal-monitor">Open Signal Monitor</a>
        </div>
        {model.scannerErrorsHiddenFromHistory && (
          <p className="dashboard-history-note">
            Historical scanner error events are hidden here because the scanner
            is currently healthy. They remain available in Alerts and Signal
            Monitor audit views.
          </p>
        )}
        <SignalEventList
          events={model.recentHistoryEvents}
          deliveries={data.notifications.deliveries}
          limit={6}
          compact
          emptyCopy="No recent signal history has been imported."
        />
      </section>
    </>
  );
}

function ScannerHealthStrip({
  model,
}: {
  model: ReturnType<typeof buildDashboardCommandCentreModel>;
}) {
  const { scanner } = model;
  return (
    <section
      className={`scanner-health-strip scanner-health-strip--${scanner.status}`}
      aria-label="Scanner health"
    >
      <div className="scanner-health-strip__title">
        {scanner.status === "current" ? (
          <CheckCircle2 size={22} />
        ) : scanner.status === "error" ? (
          <AlertTriangle size={22} />
        ) : (
          <Clock3 size={22} />
        )}
        <div>
          <span>Scanner health</span>
          <h2>{scanner.label}</h2>
        </div>
      </div>
      <dl>
        <div>
          <dt>Generated</dt>
          <dd>{formatOptionalDateTime(scanner.generatedAt)}</dd>
        </div>
        <div>
          <dt>Market data freshness</dt>
          <dd>{formatOptionalDateTime(scanner.marketDataFreshness)}</dd>
        </div>
        <div>
          <dt>Active strategies</dt>
          <dd>{scanner.activeStrategies}</dd>
        </div>
      </dl>
      {scanner.status === "error" && scanner.errors.length > 0 && (
        <ul className="dashboard-error-list">
          {scanner.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActionNeededPanel({ items }: { items: DashboardActionItem[] }) {
  return (
    <section className="control-actions dashboard-action-needed">
      <div className="control-actions__heading">
        <div>
          <span>Action needed</span>
          <h1>
            {items.length
              ? `${items.length} recent signal change${
                  items.length === 1 ? "" : "s"
                } to review`
              : "No recent signal reversals need manual action"}
          </h1>
          <p>
            Entry, exit and SMA200 regime changes from the last 7 calendar days.
            Historical scanner errors are not treated as current actions when
            the scanner is healthy.
          </p>
        </div>
        <Badge tone={items.length ? "amber" : "green"}>{items.length}</Badge>
      </div>
      {items.length ? (
        <div className="dashboard-table-wrap">
          <table className="data-table dashboard-command-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Signal → execution</th>
                <th>Event</th>
                <th>Date</th>
                <th>Reason</th>
                <th>Virtual position</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key}>
                  <td>{item.strategyName}</td>
                  <td>
                    <strong>{item.signalTicker}</strong> → {item.executionTicker}
                  </td>
                  <td>
                    <Badge tone={actionTone(item.eventType)}>
                      {actionLabel(item.eventType)}
                    </Badge>
                  </td>
                  <td>{formatDateTime(item.occurredAt)}</td>
                  <td>{item.reason}</td>
                  <td>{item.modelPositionOpen ? "open" : "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="control-no-action">
          <ShieldAlert size={22} />
          <div>
            <strong>No manual action flagged</strong>
            <p>
              No entry, exit, risk-on or risk-off event was generated in the
              last 7 calendar days.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function CurrentModelPositionsPanel({
  positions,
}: {
  positions: ReturnType<
    typeof buildDashboardCommandCentreModel
  >["currentModelPositions"];
}) {
  return (
    <section className="control-panel">
      <div className="control-panel__heading">
        <div>
          <span>Current model positions</span>
          <h2>Open virtual holdings across strategies</h2>
        </div>
        <Badge tone={positions.length ? "green" : "neutral"}>
          {positions.length}
        </Badge>
      </div>
      {positions.length ? (
        <div className="dashboard-table-wrap">
          <table className="data-table dashboard-command-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Signal → execution</th>
                <th>Entry date</th>
                <th>Days held</th>
                <th>Open P/L</th>
                <th>Allocation</th>
                <th>Reason / latest signal</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.key}>
                  <td>{position.strategyName}</td>
                  <td>
                    <strong>{position.signalTicker}</strong> →{" "}
                    {position.executionTicker}
                  </td>
                  <td>{formatOptionalDateTime(position.entryTimestamp)}</td>
                  <td>{formatNullableNumber(position.daysHeld)}</td>
                  <td>{formatPercent(position.openPnlPercent)}</td>
                  <td>{formatAllocation(position.allocation)}</td>
                  <td>
                    {position.reason ?? position.latestSignal ?? "Not supplied"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">No open virtual model positions.</div>
      )}
    </section>
  );
}

function SuperTrendSummaryCard({
  summary,
}: {
  summary: ReturnType<typeof buildDashboardCommandCentreModel>["superTrend"];
}) {
  return (
    <section className="control-panel">
      <div className="control-panel__heading">
        <div>
          <span>Daily SuperTrend</span>
          <h2>Ticker-pair state</h2>
        </div>
        <Badge tone={summary.openModelPositions ? "green" : "neutral"}>
          {summary.openModelPositions} open
        </Badge>
      </div>
      <div className="dashboard-mini-metrics">
        <Metric label="Total ticker pairs" value={summary.totalPairs} />
        <Metric label="In-market / green" value={summary.greenCount} />
        <Metric label="Out-of-market / red" value={summary.redCount} />
        <Metric label="Changed this week" value={summary.changedThisWeekCount} />
        <Metric label="Open positions" value={summary.openModelPositions} />
        <Metric label="Model value" value={formatOptionalMoney(summary.modelValue)} />
        <Metric label="Drawdown" value={formatPercent(summary.drawdownPercent)} />
      </div>
    </section>
  );
}

function Sma200SummaryCard({
  summary,
}: {
  summary: ReturnType<typeof buildDashboardCommandCentreModel>["sma200"];
}) {
  if (!summary) {
    return (
      <section className="control-panel">
        <SectionHeader
          eyebrow="Nasdaq SMA200"
          title="Regime unavailable"
          copy="No SMA200 scanner snapshot is currently available."
        />
      </section>
    );
  }

  return (
    <section className="control-panel">
      <div className="control-panel__heading">
        <div>
          <span>Nasdaq SMA200</span>
          <h2>Regime summary</h2>
        </div>
        <Badge tone={summary.currentRegime === "risk_on" ? "green" : "red"}>
          {summary.currentRegime.replace(/_/g, " ")}
        </Badge>
      </div>
      <div className="dashboard-mini-metrics">
        <Metric label="Reference ticker" value={summary.referenceTicker ?? "—"} />
        <Metric label="Execution ticker" value={summary.executionTicker ?? "—"} />
        <Metric label="Entry date" value={formatOptionalDateTime(summary.entryDate)} />
        <Metric
          label="Distance from SMA200"
          value={summary.distanceFromSma200 ?? "Not supplied"}
        />
        <Metric label="Open P/L" value={formatPercent(summary.openPnlPercent)} />
        <Metric label="Model value" value={formatOptionalMoney(summary.modelValue)} />
        <Metric label="Drawdown" value={formatPercent(summary.drawdownPercent)} />
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function actionTone(type: DashboardActionType) {
  if (type === "entry" || type === "risk_on") return "green" as const;
  return "red" as const;
}

function actionLabel(type: DashboardActionType) {
  return type.replace(/_/g, " ");
}

function formatOptionalDateTime(value: string | null) {
  return value ? formatDateTime(value) : "Not supplied";
}

function formatNullableNumber(value: number | null) {
  return value === null ? "—" : String(value);
}

function formatPercent(value: number | null) {
  return value === null ? "Unavailable" : `${formatNumber(value)}%`;
}

function formatOptionalMoney(value: number | null) {
  return value === null ? "Unavailable" : formatMoney(value);
}

function formatAllocation(value: number | null) {
  return value === null ? "Not supplied" : formatMoney(value);
}
