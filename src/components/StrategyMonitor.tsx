import {
  Activity,
  CircleDollarSign,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ModelPerformanceWarning,
  MultiStrategyRecord,
  MultiStrategyPublicState,
  StrategyId,
} from "../types";
import { formatDateTime, formatMoney, formatNumber } from "../utils/format";
import {
  affectedTickerText,
  collectStrategyPerformanceWarnings,
} from "../utils/modelWarnings";
import { Badge } from "./ui";

type MonitorTab = "all" | StrategyId;

export function StrategyMonitor({
  monitor,
  refresh,
  canRefresh = false,
  showHeading = true,
}: {
  monitor: MultiStrategyPublicState;
  refresh?: () => Promise<unknown>;
  canRefresh?: boolean;
  showHeading?: boolean;
}) {
  const [tab, setTab] = useState<MonitorTab>("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const strategies = useMemo(
    () =>
      monitor.snapshot?.strategies.filter(
        (strategy) => tab === "all" || strategy.strategyId === tab,
      ) ?? [],
    [monitor.snapshot, tab],
  );

  async function runRefresh() {
    if (!refresh) return;
    setBusy(true);
    setMessage("");
    try {
      await refresh();
      setMessage("Scanner snapshot refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!monitor.snapshot) {
    return (
      <div className="strategy-monitor">
        {showHeading && (
          <MonitorHeading
            refresh={refresh ? runRefresh : undefined}
            busy={busy}
            canRefresh={canRefresh}
          />
        )}
        <div className="truthful-empty-state">
          <Activity size={24} />
          <div>
            <h2>Awaiting first valid scanner snapshot</h2>
            <p>
              No model values, virtual positions, or performance figures are
              shown until the integrated scanner publishes a valid
              multi_strategy_v1 snapshot.
            </p>
          </div>
        </div>
        {monitor.lastError && (
          <div className="strategy-monitor__warning">
            <ShieldAlert size={18} />
            <span>{monitor.lastError}</span>
          </div>
        )}
      </div>
    );
  }

  const notConfigured =
    monitor.snapshot.scanner.status === "not_configured" ||
    monitor.snapshot.strategies.every((strategy) => !strategy.configured);

  return (
    <div className="strategy-monitor">
      {showHeading && (
        <MonitorHeading
          refresh={refresh ? runRefresh : undefined}
          busy={busy}
          canRefresh={canRefresh}
        />
      )}

      {!monitor.currentFileValid && (
        <div className="strategy-monitor__warning" role="alert">
          <ShieldAlert size={18} />
          <span>
            The current scanner output is invalid. Displaying the last known
            good snapshot. {monitor.lastError}
          </span>
        </div>
      )}
      {monitor.currentFileValid && monitor.lastError && (
        <div className="strategy-monitor__warning" role="status">
          <ShieldAlert size={18} />
          <span>{monitor.lastError}</span>
        </div>
      )}

      {notConfigured && (
        <div className="truthful-empty-state">
          <CircleDollarSign size={24} />
          <div>
            <h2>Scanner connected but strategies are not configured</h2>
            <p>
              Configure a strategy in Settings, then enable it explicitly.
              Disabled strategies never invent positions or historical results.
            </p>
          </div>
        </div>
      )}

      <div className="strategy-monitor__tabs" role="tablist">
        {[
          ["all", "All strategies"],
          ["daily-supertrend", "Daily SuperTrend"],
          ["nasdaq-sma200-3x", "Nasdaq SMA200 Regime — 3x"],
        ].map(([value, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "is-active" : ""}
            key={value}
            onClick={() => setTab(value as MonitorTab)}
          >
            {label}
          </button>
        ))}
      </div>

      {strategies.map((strategy) => (
        <StrategySection key={strategy.strategyId} strategy={strategy} />
      ))}

      {message && <div className="form-message">{message}</div>}
    </div>
  );
}

function MonitorHeading({
  refresh,
  busy,
  canRefresh,
}: {
  refresh?: () => void;
  busy: boolean;
  canRefresh: boolean;
}) {
  return (
    <header className="control-page-heading strategy-monitor__heading">
      <div>
        <span>Strategy Monitor</span>
        <h1>Independent virtual strategy sleeves</h1>
        <p>
          Model-only performance from the integrated Python scanner. These
          figures never represent actual holdings or broker execution.
        </p>
      </div>
      {refresh && (
        <button
          type="button"
          className="button button--secondary"
          onClick={refresh}
          disabled={busy || !canRefresh}
          title={
            canRefresh
              ? "Refresh scanner snapshot"
              : "Owner or admin access is required"
          }
        >
          <RefreshCw size={16} /> {busy ? "Refreshing…" : "Refresh snapshot"}
        </button>
      )}
    </header>
  );
}

function StrategySection({ strategy }: { strategy: MultiStrategyRecord }) {
  const latestEvent = strategy.latestEvent;
  const warnings = collectStrategyPerformanceWarnings(strategy);
  return (
    <section className="strategy-monitor__section">
      <div className="strategy-monitor__title">
        <div>
          <Badge
            tone={
              strategy.status === "current"
                ? "green"
                : strategy.enabled
                  ? "amber"
                  : "blue"
            }
          >
            {strategy.status.replace(/_/g, " ")}
          </Badge>
          <span>{strategy.ruleSummary}</span>
        </div>
        <h2>{strategy.name}</h2>
        <p>
          Latest data:{" "}
          {strategy.dataFreshness
            ? formatDateTime(strategy.dataFreshness)
            : "not available"}
        </p>
      </div>

      {warnings.length > 0 && <ModelWarningBanner warnings={warnings} />}

      <div className="strategy-monitor__metrics">
        <MonitorMetric
          icon={CircleDollarSign}
          label="Virtual model value"
          value={
            strategy.modelValue === null
              ? "Unavailable"
              : formatMoney(strategy.modelValue)
          }
        />
        <MonitorMetric
          icon={Activity}
          label="Model return"
          value={
            strategy.returnPercent === null
              ? "Unavailable"
              : `${formatNumber(strategy.returnPercent)}%`
          }
        />
        <MonitorMetric
          icon={TrendingDown}
          label="Model drawdown"
          value={
            strategy.drawdownPercent === null
              ? "Unavailable"
              : `${formatNumber(strategy.drawdownPercent)}%`
          }
        />
        <MonitorMetric
          icon={WalletCards}
          label="Virtual exposure"
          value={`${formatNumber(strategy.exposurePercent)}%`}
        />
      </div>

      <div className="strategy-monitor__grid">
        <article className="control-panel">
          <div className="control-panel__heading">
            <div>
              <span>Independent equity curve</span>
              <h3>{strategy.name}</h3>
            </div>
          </div>
          {strategy.equitySnapshots.length ? (
            <div className="strategy-monitor__chart">
              <ResponsiveContainer
                width="100%"
                height="100%"
                initialDimension={{ width: 700, height: 260 }}
              >
                <LineChart data={strategy.equitySnapshots}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "var(--text-muted)" }} />
                  <YAxis tick={{ fill: "var(--text-muted)" }} width={72} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                    }}
                    formatter={(value) => formatMoney(Number(value))}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="settings-note">No valid equity history yet.</p>
          )}
        </article>

        <article className="control-panel">
          <div className="control-panel__heading">
            <div>
              <span>Current state</span>
              <h3>{strategy.currentState.replace(/_/g, " ")}</h3>
            </div>
          </div>
          <dl className="strategy-monitor__facts">
            <div>
              <dt>Cash</dt>
              <dd>
                {strategy.cash === undefined
                  ? "Not supplied"
                  : formatMoney(strategy.cash)}
              </dd>
            </div>
            <div>
              <dt>Invested</dt>
              <dd>
                {strategy.investedValue === undefined
                  ? "Not supplied"
                  : formatMoney(strategy.investedValue)}
              </dd>
            </div>
            {strategy.strategyId === "nasdaq-sma200-3x" && (
              <>
                <div>
                  <dt>Execution instrument</dt>
                  <dd>{strategy.executionTicker ?? "Not configured"}</dd>
                </div>
                <div>
                  <dt>Regime start</dt>
                  <dd>{strategy.regimeStartDate ?? "No regime recorded"}</dd>
                </div>
              </>
            )}
            <div>
              <dt>Latest event</dt>
              <dd>{latestEvent?.eventType ?? "None"}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{latestEvent?.reason ?? "Awaiting a state transition."}</dd>
            </div>
          </dl>
        </article>
      </div>

      <VirtualPositions strategy={strategy} />
      {strategy.strategyId === "daily-supertrend" ? (
        <SuperTrendWatchlist strategy={strategy} />
      ) : (
        <>
          <Sma200Watchlist strategy={strategy} />
          <RegimeHistory strategy={strategy} />
        </>
      )}
      <ClosedVirtualTrades strategy={strategy} />

      <details className="strategy-monitor__parameters">
        <summary>Configured parameters</summary>
        <pre>{JSON.stringify(strategy.parameters, null, 2)}</pre>
      </details>
    </section>
  );
}

function MonitorMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <article>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>Virtual model only</small>
    </article>
  );
}

function ModelWarningBanner({
  warnings,
}: {
  warnings: ModelPerformanceWarning[];
}) {
  return (
    <div className="strategy-monitor__warning" role="alert">
      <ShieldAlert size={18} />
      <div>
        <strong>Model performance needs review</strong>
        <p>
          Signal state may still be valid, but model returns/P&amp;L should be
          reviewed before relying on them.
        </p>
        <ul>
          {warnings.slice(0, 5).map((warning, index) => (
            <li key={`${warning.code}-${index}`}>
              <span>{affectedTickerText(warning)}:</span> {warning.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function VirtualPositions({ strategy }: { strategy: MultiStrategyRecord }) {
  return (
    <article className="control-panel">
      <div className="control-panel__heading">
        <div>
          <span>Virtual model positions</span>
          <h3>Never actual holdings</h3>
        </div>
        <Badge tone="blue">{strategy.virtualPositions.length}</Badge>
      </div>
      {strategy.virtualPositions.length === 0 ? (
        <p className="settings-note">No virtual model position is open.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Signal → execution</th>
                <th>State</th>
                <th>Allocation</th>
                <th>Open P/L</th>
                <th>Warnings</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {strategy.virtualPositions.map((position) => (
                <tr key={position.positionId}>
                  <td>{position.label}</td>
                  <td>
                    {position.signalTicker} → {position.executionTicker}
                  </td>
                  <td>{position.state}</td>
                  <td>{formatNumber(position.allocation)}%</td>
                  <td>
                    {formatMoney(position.openPnlValue)} ·{" "}
                    {formatNumber(position.openPnlPercent)}%
                  </td>
                  <td>
                    {position.warnings?.length
                      ? position.warnings.map((warning) => warning.code).join(", ")
                      : "—"}
                  </td>
                  <td>{position.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function SuperTrendWatchlist({
  strategy,
}: {
  strategy: MultiStrategyRecord;
}) {
  const rows = Array.isArray(strategy.parameters.watchlist)
    ? strategy.parameters.watchlist.filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === "object" && !Array.isArray(value),
      )
    : [];
  return (
    <article className="control-panel">
      <div className="control-panel__heading">
        <div>
          <span>Monitored tickers</span>
          <h3>SuperTrend mapping and virtual state</h3>
        </div>
        <Badge tone="blue">{rows.length}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="settings-note">No verified watchlist mapping configured.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Signal → UK execution</th>
                <th>In / out</th>
                <th>Entry</th>
                <th>Latest</th>
                <th>Virtual P/L</th>
                <th>Days held</th>
                <th>Latest reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const signalTicker = String(row.signalTicker ?? "");
                const executionTicker = String(row.executionTicker ?? "");
                const position = strategy.virtualPositions.find(
                  (item) =>
                    item.signalTicker === signalTicker &&
                    item.executionTicker === executionTicker,
                );
                const latestEvent = [...strategy.events]
                  .reverse()
                  .find(
                    (event) =>
                      event.signalTicker === signalTicker &&
                      event.executionTicker === executionTicker,
                  );
                return (
                  <tr key={`${signalTicker}-${executionTicker}-${index}`}>
                    <td>{row.enabled === true ? "Yes" : "No"}</td>
                    <td>
                      {signalTicker || "—"} → {executionTicker || "—"}
                    </td>
                    <td>{position?.state ?? "out"}</td>
                    <td>
                      {position?.entryTimestamp ?? "—"}
                      {position?.entryPrice === null ||
                      position?.entryPrice === undefined
                        ? ""
                        : ` · ${formatMoney(position.entryPrice)}`}
                    </td>
                    <td>
                      {position?.latestPrice === null ||
                      position?.latestPrice === undefined
                        ? "—"
                        : formatMoney(position.latestPrice)}
                    </td>
                    <td>
                      {position
                        ? `${formatMoney(position.openPnlValue)} · ${formatNumber(position.openPnlPercent)}%`
                        : "—"}
                    </td>
                    <td>{position?.daysHeld ?? "—"}</td>
                    <td>{latestEvent?.reason ?? "No transition recorded."}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function Sma200Watchlist({ strategy }: { strategy: MultiStrategyRecord }) {
  const rows = Array.isArray(strategy.parameters.watchlist)
    ? strategy.parameters.watchlist.filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === "object" && !Array.isArray(value),
      )
    : [];
  const fallbackRows =
    rows.length > 0
      ? rows
      : [
          {
            signalTicker:
              strategy.referenceTicker ?? strategy.parameters.referenceTicker,
            executionTicker:
              strategy.parameters.riskOnTicker ?? strategy.executionTicker,
            enabled: strategy.enabled,
          },
        ].filter((row) => row.signalTicker || row.executionTicker);
  return (
    <article className="control-panel">
      <div className="control-panel__heading">
        <div>
          <span>Monitored tickers</span>
          <h3>SMA200 signal/reference mappings</h3>
        </div>
        <Badge tone="blue">{fallbackRows.length}</Badge>
      </div>
      {fallbackRows.length === 0 ? (
        <p className="settings-note">No SMA200 ticker-pair mapping configured.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Signal/reference → execution</th>
                <th>Regime</th>
                <th>Entry</th>
                <th>Latest</th>
                <th>Virtual P/L</th>
                <th>Days held</th>
                <th>Latest reason</th>
              </tr>
            </thead>
            <tbody>
              {fallbackRows.map((row, index) => {
                const signalTicker = String(row.signalTicker ?? "");
                const executionTicker = String(row.executionTicker ?? "");
                const position = strategy.virtualPositions.find(
                  (item) =>
                    item.signalTicker === signalTicker &&
                    item.executionTicker === executionTicker,
                );
                const latestEvent = [...strategy.events]
                  .reverse()
                  .find(
                    (event) =>
                      event.signalTicker === signalTicker &&
                      event.executionTicker === executionTicker,
                  );
                return (
                  <tr key={`sma-${signalTicker}-${executionTicker}-${index}`}>
                    <td>{row.enabled === true ? "Yes" : "No"}</td>
                    <td>
                      {signalTicker || "—"} → {executionTicker || "—"}
                    </td>
                    <td>{position ? "risk_on" : "risk_off"}</td>
                    <td>
                      {position?.entryTimestamp ?? "—"}
                      {position?.entryPrice === null ||
                      position?.entryPrice === undefined
                        ? ""
                        : ` · ${formatMoney(position.entryPrice)}`}
                    </td>
                    <td>
                      {position?.latestPrice === null ||
                      position?.latestPrice === undefined
                        ? "—"
                        : formatMoney(position.latestPrice)}
                    </td>
                    <td>
                      {position
                        ? `${formatMoney(position.openPnlValue)} · ${formatNumber(position.openPnlPercent)}%`
                        : "—"}
                    </td>
                    <td>{position?.daysHeld ?? "—"}</td>
                    <td>{latestEvent?.reason ?? "No SMA transition recorded."}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function RegimeHistory({ strategy }: { strategy: MultiStrategyRecord }) {
  const events = strategy.regimeChangeEvents ?? strategy.events;
  return (
    <article className="control-panel">
      <div className="control-panel__heading">
        <div>
          <span>Regime-change history</span>
          <h3>Nasdaq SMA state transitions</h3>
        </div>
        <Badge tone="blue">{events.length}</Badge>
      </div>
      {events.length === 0 ? (
        <p className="settings-note">No regime change has been recorded.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Occurred</th>
                <th>State change</th>
                <th>Reference → execution</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.eventId}>
                  <td>{formatDateTime(event.occurredAt)}</td>
                  <td>{event.eventType === "entry" ? "Risk on" : "Risk off"}</td>
                  <td>
                    {event.signalTicker} → {event.executionTicker}
                  </td>
                  <td>{event.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function ClosedVirtualTrades({
  strategy,
}: {
  strategy: MultiStrategyRecord;
}) {
  const trades = strategy.closedVirtualTrades;
  return (
    <article className="control-panel">
      <div className="control-panel__heading">
        <div>
          <span>Closed virtual trades</span>
          <h3>Model-only completed positions</h3>
        </div>
        <Badge tone="blue">{trades.length}</Badge>
      </div>
      {trades.length === 0 ? (
        <p className="settings-note">No virtual model trade has closed yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Instrument</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Virtual P/L</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, index) => (
                <tr key={String(trade.positionId ?? index)}>
                  <td>Virtual model position</td>
                  <td>{String(trade.executionTicker ?? "—")}</td>
                  <td>
                    {String(trade.entryTimestamp ?? "—")} ·{" "}
                    {numberOrDash(trade.entryPrice)}
                  </td>
                  <td>
                    {String(trade.exitTimestamp ?? "—")} ·{" "}
                    {numberOrDash(trade.exitPrice)}
                  </td>
                  <td>
                    {numberOrDash(trade.pnlValue)} ·{" "}
                    {percentOrDash(trade.pnlPercent)}
                  </td>
                  <td>{String(trade.exitReason ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function numberOrDash(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? formatMoney(value)
    : "—";
}

function percentOrDash(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${formatNumber(value)}%`
    : "—";
}
