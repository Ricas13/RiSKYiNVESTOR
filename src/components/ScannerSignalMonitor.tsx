import {
  Activity,
  CalendarClock,
  CircleAlert,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import * as React from "react";
import type { MultiStrategyPublicState } from "../types";
import {
  buildSignalMonitorModel,
  type SignalRowStatus,
  type Sma200SignalRow,
  type Sma200SignalSummary,
  type SuperTrendSignalRow,
} from "../utils/signalMonitorRows";
import { formatDateTime, formatMoney, formatNumber } from "../utils/format";
import { collectSnapshotPerformanceWarnings } from "../utils/modelWarnings";
import { Badge } from "./ui";

export function ScannerSignalMonitor({
  monitor,
}: {
  monitor: MultiStrategyPublicState;
}) {
  const model = React.useMemo(
    () => buildSignalMonitorModel(monitor.snapshot),
    [monitor.snapshot],
  );
  const snapshot = monitor.snapshot;
  const performanceWarnings = React.useMemo(
    () => collectSnapshotPerformanceWarnings(snapshot),
    [snapshot],
  );

  if (!snapshot) {
    return (
      <section className="signal-monitor-board">
        <div className="truthful-empty-state">
          <Activity size={24} />
          <div>
            <h2>Awaiting first valid scanner snapshot</h2>
            <p>
              Signal Monitor will show ticker-pair rows only after the scanner
              publishes a valid multi_strategy_v1 snapshot.
            </p>
          </div>
        </div>
        {monitor.lastError && (
          <ScannerWarning>{monitor.lastError}</ScannerWarning>
        )}
      </section>
    );
  }

  const statusNeedsReview =
    !monitor.currentFileValid || snapshot.scanner.status !== "current";

  return (
    <section className="signal-monitor-board">
      {statusNeedsReview && (
        <ScannerWarning>
          {monitor.currentFileValid
            ? `Scanner status is ${snapshot.scanner.status.replace(/_/g, " ")}. Displaying available durable scanner rows only.`
            : `The current scanner output is invalid. Displaying the last known good ticker-pair table. ${monitor.lastError ?? ""}`}
        </ScannerWarning>
      )}
      {!statusNeedsReview && monitor.lastError && (
        <ScannerWarning>{monitor.lastError}</ScannerWarning>
      )}
      {performanceWarnings.length > 0 && (
        <ScannerWarning>
          Performance warning: this model result may be distorted by leveraged
          ETP price history or currency units. Signal state may still be valid,
          but model returns/P&amp;L should be reviewed before relying on them.
        </ScannerWarning>
      )}

      <div className="control-metric-grid signal-monitor-summary">
        <SummaryCard
          icon={Activity}
          label="Total ticker pairs"
          value={String(model.summary.totalPairs)}
          detail="Daily SuperTrend rows"
          tone="blue"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Green / in market"
          value={String(model.summary.greenCount)}
          detail="Open virtual model rows"
          tone="green"
        />
        <SummaryCard
          icon={TrendingDown}
          label="Red / out of market"
          value={String(model.summary.redCount)}
          detail="No open model position"
          tone="red"
        />
        <SummaryCard
          icon={RefreshCw}
          label="Changed this week"
          value={String(model.summary.changedThisWeekCount)}
          detail="Entry or exit event"
          tone={model.summary.changedThisWeekCount ? "amber" : "blue"}
        />
        <SummaryCard
          icon={WalletCards}
          label="Open model positions"
          value={String(model.summary.openModelPositions)}
          detail="Virtual positions only"
          tone="purple"
        />
        <SummaryCard
          icon={CalendarClock}
          label="Scanner freshness"
          value={snapshot.scanner.status.replace(/_/g, " ")}
          detail={formatOptionalDate(model.summary.scannerFreshness)}
          tone={snapshot.scanner.status === "current" ? "green" : "amber"}
        />
      </div>

      <article className="control-panel">
        <div className="control-panel__heading">
          <div>
            <span>Daily SuperTrend</span>
            <h2>Ticker-pair signal table</h2>
          </div>
          <Badge tone="blue">{model.rows.length} pairs</Badge>
        </div>

        {model.rows.length === 0 ? (
          <div className="truthful-empty-state signal-monitor-empty">
            <CircleAlert size={24} />
            <div>
              <h2>No Daily SuperTrend ticker pairs</h2>
              <p>
                Add ticker-pair rows in{" "}
                <a href="#/settings">Settings → Strategy Configuration</a>,
                then enable the strategy when ready.
              </p>
            </div>
          </div>
        ) : (
          <SuperTrendSignalTable rows={model.rows} />
        )}
      </article>

      <Sma200Card summary={model.sma200} />
    </section>
  );
}

function SuperTrendSignalTable({ rows }: { rows: SuperTrendSignalRow[] }) {
  return (
    <div className="table-scroll signal-monitor-table-wrap">
      <table className="data-table signal-monitor-table">
        <thead>
          <tr>
            <th>Signal ticker</th>
            <th>Execution ticker</th>
            <th>Strategy</th>
            <th>Current signal/status</th>
            <th>Latest event</th>
            <th>Latest signal date</th>
            <th>Changed this week</th>
            <th>Model position</th>
            <th>Open P/L</th>
            <th>Days held</th>
            <th>Data freshness</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.signalTicker}-${row.executionTicker}`}>
              <td>
                <strong>{row.signalTicker || "—"}</strong>
              </td>
              <td>{row.executionTicker || "—"}</td>
              <td>{row.strategy}</td>
              <td>
                <Badge tone={statusTone(row.status)}>
                  <span className="status-dot" aria-hidden="true" />
                  {row.statusLabel}
                </Badge>
                {!row.enabled && <small>Disabled</small>}
              </td>
              <td>{row.latestEventType}</td>
              <td>{formatOptionalDate(row.latestSignalDate)}</td>
              <td>
                <Badge tone={row.changedThisWeek ? "amber" : "neutral"}>
                  {row.changedThisWeek ? "yes" : "no"}
                </Badge>
              </td>
              <td>
                <Badge tone={row.modelPosition === "open" ? "green" : "blue"}>
                  {row.modelPosition}
                </Badge>
              </td>
              <td>{formatPositionPnl(row)}</td>
              <td>{row.daysHeld ?? "—"}</td>
              <td>{formatOptionalDate(row.dataFreshness)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sma200Card({ summary }: { summary: Sma200SignalSummary | null }) {
  if (!summary) {
    return (
      <article className="control-panel">
        <div className="control-panel__heading">
          <div>
            <span>SMA200</span>
            <h2>Nasdaq SMA200 regime</h2>
          </div>
        </div>
        <p className="settings-note">No SMA200 strategy snapshot is available.</p>
      </article>
    );
  }

  return (
    <article className="control-panel signal-monitor-sma">
      <div className="control-panel__heading">
        <div>
          <span>SMA200</span>
          <h2>Nasdaq SMA200 ticker-pair book</h2>
        </div>
        <Badge tone={summary.currentRegime === "risk_on" ? "green" : "red"}>
          {summary.currentRegime.replace(/_/g, " ")}
        </Badge>
      </div>
      <dl className="signal-monitor-sma__grid">
        <Fact label="Reference ticker" value={summary.referenceTicker ?? "—"} />
        <Fact label="Execution ticker" value={summary.executionTicker ?? "—"} />
        <Fact
          label="Current regime"
          value={summary.currentRegime.replace(/_/g, " ")}
        />
        <Fact label="Latest SMA200 event" value={summary.latestEventType} />
        <Fact
          label="Latest signal date"
          value={formatOptionalDate(summary.latestSignalDate)}
        />
        <Fact label="Open model position" value={summary.modelPosition} />
        <Fact
          label="Open P/L"
          value={
            summary.openPnlValue === null
              ? "—"
              : `${formatMoney(summary.openPnlValue)} · ${formatNumber(summary.openPnlPercent ?? 0)}%`
          }
        />
        <Fact
          label="Days held"
          value={summary.daysHeld === null ? "—" : String(summary.daysHeld)}
        />
      </dl>
      {summary.rows.length > 0 && (
        <Sma200SignalTable rows={summary.rows} />
      )}
    </article>
  );
}

function Sma200SignalTable({ rows }: { rows: Sma200SignalRow[] }) {
  return (
    <div className="table-scroll signal-monitor-table-wrap">
      <table className="data-table signal-monitor-table">
        <thead>
          <tr>
            <th>Signal ticker</th>
            <th>Execution ticker</th>
            <th>Current regime</th>
            <th>Latest event</th>
            <th>Latest signal date</th>
            <th>Model position</th>
            <th>Open P/L</th>
            <th>Days held</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.signalTicker}-${row.executionTicker}`}>
              <td>
                <strong>{row.signalTicker || "—"}</strong>
                {!row.enabled && <small>Disabled</small>}
              </td>
              <td>{row.executionTicker || "—"}</td>
              <td>
                <Badge tone={row.currentRegime === "risk_on" ? "green" : "red"}>
                  {row.currentRegime.replace(/_/g, " ")}
                </Badge>
              </td>
              <td>{row.latestEventType}</td>
              <td>{formatOptionalDate(row.latestSignalDate)}</td>
              <td>
                <Badge tone={row.modelPosition === "open" ? "green" : "blue"}>
                  {row.modelPosition}
                </Badge>
              </td>
              <td>{formatSmaPnl(row)}</td>
              <td>{row.daysHeld ?? "—"}</td>
              <td>{row.latestReason ?? "No SMA200 transition recorded."}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone: "green" | "red" | "amber" | "blue" | "purple";
}) {
  return (
    <article className={`control-metric control-metric--${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ScannerWarning({ children }: { children: React.ReactNode }) {
  return (
    <div className="strategy-monitor__warning" role="alert">
      <ShieldAlert size={18} />
      <span>{children}</span>
    </div>
  );
}

function statusTone(status: SignalRowStatus) {
  if (status === "in") return "green" as const;
  if (status === "out") return "red" as const;
  if (status === "error") return "red" as const;
  return "amber" as const;
}

function formatPositionPnl(row: SuperTrendSignalRow) {
  if (row.openPnlValue === null) return "—";
  return `${formatMoney(row.openPnlValue)} · ${formatNumber(row.openPnlPercent ?? 0)}%`;
}

function formatSmaPnl(row: Sma200SignalRow) {
  if (row.openPnlValue === null) return "—";
  return `${formatMoney(row.openPnlValue)} · ${formatNumber(row.openPnlPercent ?? 0)}%`;
}

function formatOptionalDate(value: string | null) {
  return value ? formatDateTime(value) : "—";
}
