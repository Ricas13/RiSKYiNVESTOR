import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ShieldAlert,
} from "lucide-react";
import * as React from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardData } from "../types";
import {
  buildActualTradeEquityModel,
  type ActualTradeEquityModel,
} from "../utils/actualTradeEquity";
import {
  buildDashboardCommandCentreModel,
  type DashboardActionItem,
  type DashboardActionType,
} from "../utils/dashboardCommandCentre";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "../utils/format";
import { SignalEventList } from "./SignalEvents";
import { Badge, SectionHeader } from "./ui";

export function DashboardCommandCentre({
  data,
  onOpenTicker,
}: {
  data: DashboardData;
  onOpenTicker?: (ticker: string) => void;
}) {
  const model = buildDashboardCommandCentreModel(data);
  const actualTradeEquity = buildActualTradeEquityModel(
    data.manualTrades.trades,
  );

  if (!model.hasScannerSnapshot && model.scanner.status === "awaiting") {
    return (
      <div className="dashboard-command-centre">
        <ScannerHealthStrip model={model} />
        <ActualTradeEquityPanel model={actualTradeEquity} />
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
      </div>
    );
  }

  return (
    <div className="dashboard-command-centre">
      <ScannerHealthStrip model={model} />
      <ActionNeededPanel items={model.actionItems} onOpenTicker={onOpenTicker} />
      <CurrentModelPositionsPanel
        onOpenTicker={onOpenTicker}
        positions={model.currentModelPositions}
      />
      <ActualTradeEquityPanel model={actualTradeEquity} />
      <section className="dashboard-command-grid">
        <SuperTrendSummaryCard summary={model.superTrend} />
        <Sma200SummaryCard summary={model.sma200} />
      </section>
      <section className="control-panel">
        <div className="control-panel__heading">
          <div>
            <span>Recent signal history</span>
            <h2>Latest scanner audit notes</h2>
          </div>
          <a href="#/alerts">View full history in Alerts</a>
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
          limit={5}
          compact
          emptyCopy="No recent signal history has been imported."
          onOpenTicker={onOpenTicker}
        />
      </section>
    </div>
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
      {scanner.warnings.length > 0 && (
        <div className="dashboard-history-note" role="status">
          <strong>Performance warning:</strong> Signal state may still be valid,
          but model returns/P&amp;L need review.{" "}
          <a href="#/strategies">Open Strategy Performance</a>.
        </div>
      )}
    </section>
  );
}

function ActionNeededPanel({
  items,
  onOpenTicker,
}: {
  items: DashboardActionItem[];
  onOpenTicker?: (ticker: string) => void;
}) {
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
              : "No current signal actions require review."}
          </h1>
          <p>
            Current, unacknowledged entry, exit, SMA200 regime and scanner-error
            actions from the latest review window. Historical scanner errors are
            not treated as current actions when the scanner is healthy.
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
                    <TickerChartButton
                      onOpenTicker={onOpenTicker}
                      ticker={item.executionTicker}
                    />
                  </td>
                  <td>
                    <Badge tone={actionTone(item.eventType)}>
                      {actionLabel(item.eventType)}
                    </Badge>
                  </td>
                  <td>
                    <strong>Signal date: {formatOptionalDate(item.signalDate)}</strong>
                    <small>Generated: {formatOptionalDateTime(item.generatedAt)}</small>
                  </td>
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
              No current, unacknowledged entry, exit, risk-on, risk-off or
              scanner-error alert requires review.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function CurrentModelPositionsPanel({
  positions,
  onOpenTicker,
}: {
  positions: ReturnType<
    typeof buildDashboardCommandCentreModel
  >["currentModelPositions"];
  onOpenTicker?: (ticker: string) => void;
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
                    <TickerChartButton
                      onOpenTicker={onOpenTicker}
                      ticker={position.executionTicker}
                    />
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

function ActualTradeEquityPanel({
  model,
}: {
  model: ActualTradeEquityModel;
}) {
  return (
    <section className="control-panel actual-trade-equity-panel">
      <div className="control-panel__heading">
        <div>
          <span>Actual trading progress</span>
          <h2>Actual trade equity</h2>
          <p>
            Based only on trades you manually recorded. Open trade values are
            estimated only when a reference/current price is available. This is
            not broker-synced.
          </p>
        </div>
        <Badge tone={model.hasTrades ? "blue" : "neutral"}>
          {model.openTrades} open · {model.closedTrades} closed
        </Badge>
      </div>
      {!model.hasTrades ? (
        <div className="empty-state actual-trade-empty">
          <strong>No manual trades recorded yet.</strong>
          <span>
            Record trades in Trade Journal to build your actual equity curve.
          </span>
        </div>
      ) : (
        <>
          <div className="actual-trade-summary-grid">
            <Metric label="Total invested" value={formatMoney(model.totalInvested)} />
            <Metric label="Realised P/L" value={formatMoney(model.realisedPnl)} />
            <Metric
              label="Unrealised P/L"
              value={
                model.unrealisedPnl === null
                  ? "No current price"
                  : formatMoney(model.unrealisedPnl)
              }
            />
            <Metric label="Total P/L" value={formatMoney(model.totalPnl)} />
            <Metric label="Open trades" value={model.openTrades} />
            <Metric label="Closed trades" value={model.closedTrades} />
          </div>
          <div
            className="actual-trade-equity-chart"
            aria-label="Actual trade equity chart"
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 920, height: 260 }}
            >
              <LineChart data={model.points}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={chartTick}
                  tickFormatter={shortDate}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={chartTick}
                  tickFormatter={compactMoney}
                  axisLine={false}
                  tickLine={false}
                  width={62}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={moneyTooltip}
                  labelFormatter={(value) => shortDate(String(value))}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="realisedPnl"
                  name="Realised P/L"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={false}
                />
                {model.hasUnrealisedEstimate && (
                  <Line
                    type="monotone"
                    dataKey="estimatedTotalPnl"
                    name="Estimated total P/L"
                    stroke="#50c897"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
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

function TickerChartButton({
  ticker,
  onOpenTicker,
}: {
  ticker: string;
  onOpenTicker?: (ticker: string) => void;
}) {
  if (!onOpenTicker) return <>{ticker}</>;
  return (
    <button
      className="ticker-chart-link"
      onClick={() => onOpenTicker(ticker)}
      type="button"
    >
      {ticker}
    </button>
  );
}

function formatOptionalDate(value: string | null) {
  return value ? formatDate(value) : "Not supplied";
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

const chartTick = {
  fill: "var(--text-muted)",
  fontSize: 11,
};

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--text-primary)",
};

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function compactMoney(value: number | string) {
  const number = Number(value);
  return Number.isFinite(number) ? formatMoney(number) : "—";
}

function moneyTooltip(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? formatMoney(number) : "—";
}
