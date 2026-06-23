import { X } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ManualTrade,
  MultiStrategyEvent,
  MultiStrategyPublicState,
  StrategyChartCandle,
} from "../types";
import { formatDate, formatMoney } from "../utils/format";
import { strategySignalDate } from "../utils/signalDates";
import { Badge } from "./ui";

interface ChartMarker {
  id: string;
  date: string;
  price: number | null;
  label: string;
  strategyName: string;
  eventType: string;
  signalTicker: string;
  executionTicker: string;
  calculationTicker: string;
  source: "scanner/model" | "manual";
}

export function StrategyTickerChart({
  ticker,
  monitor,
  manualTrades,
  onClose,
}: {
  ticker: string | null;
  monitor: MultiStrategyPublicState;
  manualTrades: ManualTrade[];
  onClose: () => void;
}) {
  if (!ticker) return null;
  const model = buildStrategyTickerChartModel(ticker, monitor, manualTrades);
  return (
    <div className="strategy-chart-backdrop" role="presentation">
      <section
        aria-label={`${model.ticker} strategy chart`}
        className="strategy-chart-modal"
        role="dialog"
      >
        <div className="strategy-chart-modal__heading">
          <div>
            <span>Strategy chart</span>
            <h2>{model.ticker} strategy chart</h2>
            <p>
              Shows leveraged ticker candles with strategy entry/exit markers.
              Entry signals may be calculated from the unleveraged signal ticker;
              SuperTrend exits are calculated from the leveraged execution ticker.
            </p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            <X size={16} /> Close
          </button>
        </div>

        {model.candles.length === 0 ? (
          <div className="empty-state">No chart data available for this ticker yet.</div>
        ) : (
          <div className="strategy-chart-plot" data-candle-count={model.candles.length}>
            <ResponsiveContainer height={320} width="100%">
              <LineChart data={model.candles}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" minTickGap={24} />
                <YAxis domain={["auto", "auto"]} width={72} />
                <Tooltip formatter={(value) => formatMoney(Number(value), 2)} />
                <Line
                  dataKey="close"
                  dot={false}
                  name="Close"
                  stroke="#61a8ff"
                  strokeWidth={2}
                  type="monotone"
                />
                {model.markers
                  .filter((marker) => marker.price !== null)
                  .slice(-80)
                  .map((marker) => (
                    <ReferenceDot
                      fill={marker.eventType.includes("entry") || marker.label.includes("buy") ? "#26d980" : "#ff5f69"}
                      ifOverflow="extendDomain"
                      key={marker.id}
                      r={5}
                      stroke="#0b1220"
                      x={marker.date}
                      y={marker.price ?? 0}
                    />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="strategy-chart-marker-panel">
          <div className="control-panel__heading">
            <div>
              <span>Markers</span>
              <h3>Strategy and manual trade markers</h3>
            </div>
            <Badge tone="blue">{model.markers.length}</Badge>
          </div>
          {model.markers.length === 0 ? (
            <div className="empty-state">No strategy markers available for this ticker yet.</div>
          ) : (
            <ul className="strategy-chart-markers">
              {model.markers.map((marker) => (
                <li
                  key={marker.id}
                  title={`${marker.strategyName}; ${marker.eventType}; Signal date: ${marker.date}; Calculated on: ${marker.calculationTicker}; Signal ticker: ${marker.signalTicker}; Execution ticker: ${marker.executionTicker}; Source: ${marker.source}`}
                >
                  <Badge tone={marker.eventType.includes("entry") || marker.label.includes("buy") ? "green" : "red"}>
                    {marker.label}
                  </Badge>
                  <strong>{formatDate(marker.date)}</strong>
                  <span>{marker.strategyName}</span>
                  <small>
                    Calculated on: {marker.calculationTicker} ·{" "}
                    {marker.price === null ? "price unavailable" : formatMoney(marker.price, 2)}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function buildStrategyTickerChartModel(
  ticker: string,
  monitor: MultiStrategyPublicState,
  manualTrades: ManualTrade[],
) {
  const normalizedTicker = ticker.trim().toUpperCase();
  const chartSources =
    monitor.snapshot?.strategies.flatMap((strategy) => strategy.chartData ?? []) ?? [];
  const candles = chartSources
    .filter((chart) => sameTicker(chart.executionTicker, normalizedTicker))
    .sort((left, right) => right.candles.length - left.candles.length)[0]
    ?.candles.slice(-250) ?? [];
  const byDate = new Map(candles.map((candle) => [candle.date, candle]));
  const strategyMarkers =
    monitor.snapshot?.strategies.flatMap((strategy) =>
      strategy.events
        .filter(
          (event) =>
            sameTicker(event.executionTicker, normalizedTicker) &&
            (event.eventType === "entry" || event.eventType === "exit"),
        )
        .map((event) =>
          strategyEventMarker(event, strategy.name, byDate.get(strategySignalDate(event) ?? "")),
        ),
    ) ?? [];
  const manualMarkers = manualTrades.flatMap((trade) =>
    manualTradeMarkers(trade, normalizedTicker),
  );
  const markers = [...strategyMarkers, ...manualMarkers]
    .filter((marker) => !candles.length || byDate.has(marker.date))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-120);
  return { ticker: normalizedTicker, candles, markers };
}

function strategyEventMarker(
  event: MultiStrategyEvent,
  strategyName: string,
  candle: StrategyChartCandle | undefined,
): ChartMarker {
  const isSma = event.strategyId === "nasdaq-sma200-3x";
  const signalDate = strategySignalDate(event) ?? event.occurredAt.slice(0, 10);
  return {
    id: event.eventId,
    date: signalDate,
    price: event.price ?? candle?.close ?? null,
    label: `${isSma ? "SMA200" : "SuperTrend"} ${event.eventType}`,
    strategyName,
    eventType: event.eventType,
    signalTicker: event.signalTicker,
    executionTicker: event.executionTicker,
    calculationTicker: event.calculationTicker ?? event.signalTicker,
    source: "scanner/model",
  };
}

function manualTradeMarkers(trade: ManualTrade, ticker: string): ChartMarker[] {
  if (!sameTicker(trade.ticker, ticker)) return [];
  const entry: ChartMarker = {
    id: `${trade.id}:entry`,
    date: trade.entryDate.slice(0, 10),
    price: trade.entryPrice,
    label: "Manual buy",
    strategyName: trade.strategyName || "Manual",
    eventType: "manual entry",
    signalTicker: trade.ticker,
    executionTicker: trade.ticker,
    calculationTicker: trade.ticker,
    source: "manual",
  };
  const exits = trade.exits.map((exit) => ({
    id: `${trade.id}:${exit.id}`,
    date: exit.exitDate.slice(0, 10),
    price: exit.exitPrice,
    label: "Manual sell",
    strategyName: trade.strategyName || "Manual",
    eventType: "manual exit",
    signalTicker: trade.ticker,
    executionTicker: trade.ticker,
    calculationTicker: trade.ticker,
    source: "manual" as const,
  }));
  return [entry, ...exits];
}

function sameTicker(left: string, right: string) {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}
