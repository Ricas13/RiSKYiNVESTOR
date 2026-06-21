import type {
  ManualTrade,
  MultiStrategyEvent,
  MultiStrategyPublicState,
  MultiStrategyRecord,
} from "../types";
import { calculateTrade } from "./manualTrades";

export const STRATEGY_OPTIONS = [
  "Daily SuperTrend",
  "Nasdaq SMA200",
  "Manual / Discretionary",
] as const;

export type StrategySource = (typeof STRATEGY_OPTIONS)[number];
export type TradeActionType = "open" | "close";

export interface SimpleTradeFormState {
  strategySource: StrategySource;
  ticker: string;
  action: TradeActionType;
  tradeDate: string;
  quantity: string;
  price: string;
  totalCost: string;
  fees: string;
  notes: string;
}

export interface SignalActionOption {
  optionId: string;
  group: "open_model_position" | "recent_event";
  label: string;
  strategySource: StrategySource;
  ticker: string;
  action: TradeActionType;
  reason: string;
}

export interface OpenTradeRow {
  trade: ManualTrade;
  dateOpened: string;
  strategySource: StrategySource;
  ticker: string;
  quantityRemaining: number;
  entryPrice: number;
  totalCost: number;
  fees: number;
  notes: string;
}

export interface ClosedTradeRow {
  trade: ManualTrade;
  dateOpened: string;
  dateClosed: string;
  strategySource: StrategySource;
  ticker: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  totalCost: number;
  totalPnl: number;
  pnlPercent: number;
  notes: string;
}

export const emptySimpleTradeForm = (): SimpleTradeFormState => ({
  strategySource: "Daily SuperTrend",
  ticker: "",
  action: "open",
  tradeDate: toDateTimeLocal(new Date().toISOString()),
  quantity: "",
  price: "",
  totalCost: "",
  fees: "0",
  notes: "",
});

export function buildSignalActionOptions(
  monitor: MultiStrategyPublicState,
): SignalActionOption[] {
  const snapshot = monitor.snapshot;
  if (!snapshot) return [];

  const options = new Map<string, SignalActionOption>();

  for (const strategy of snapshot.strategies) {
    const source = sourceForStrategy(strategy);
    if (!source) continue;

    for (const position of strategy.virtualPositions) {
      addOption(options, {
        optionId: `position:${position.positionId}`,
        group: "open_model_position",
        label: `Open model position · ${source} · ${position.executionTicker}`,
        strategySource: source,
        ticker: position.executionTicker,
        action: "open",
        reason: position.reason || "Open virtual model position.",
      });
    }

    for (const event of recentActionableEvents(strategy.events)) {
      addOption(options, {
        optionId: `event:${event.eventId}`,
        group: "recent_event",
        label: `Recent ${event.eventType === "exit" ? "exit" : "entry"} · ${source} · ${event.executionTicker}`,
        strategySource: source,
        ticker: event.executionTicker,
        action: event.eventType === "exit" ? "close" : "open",
        reason: event.reason,
      });
    }
  }

  return [...options.values()].sort((left, right) => {
    const groupOrder = groupPriority(left.group) - groupPriority(right.group);
    if (groupOrder !== 0) return groupOrder;
    return left.label.localeCompare(right.label);
  });
}

export function applySignalActionOption(
  form: SimpleTradeFormState,
  option: SignalActionOption,
): SimpleTradeFormState {
  return {
    ...form,
    strategySource: option.strategySource,
    ticker: option.ticker,
    action: option.action,
    notes: option.reason && !form.notes ? option.reason : form.notes,
  };
}

export function buildManualTradePayload(form: SimpleTradeFormState) {
  const price = positiveNumber(form.price);
  const quantity = positiveNumber(form.quantity);
  const totalCost = positiveNumber(form.totalCost, false) || quantity * price;
  const fees = positiveNumber(form.fees, false);
  const ticker = form.ticker.trim().toUpperCase();

  return {
    strategyName: form.strategySource,
    sleeve: sleeveForSource(form.strategySource),
    assetName: ticker,
    ticker,
    direction: "long",
    riskTier: "CORE",
    assetClass: "Manual trade",
    isTechnology: false,
    isSingleStock: false,
    leverageMultiplier: 1,
    entryDate: form.tradeDate,
    entryPrice: price,
    quantity,
    amountInvested: totalCost,
    fees,
    notes: form.notes,
    source: "manual",
    referenceLink: "",
    currentPrice: price,
    journal: {
      entryReason: form.notes,
      followedSystem: false,
      overrodeSystem: false,
      emotionalState: "",
      checkedChart: false,
      lesson: "",
    },
  };
}

export function buildManualExitPayload(
  form: SimpleTradeFormState,
  remainingQuantity: number,
) {
  return {
    exitDate: form.tradeDate,
    exitPrice: positiveNumber(form.price),
    quantitySold: positiveNumber(form.quantity, false) || remainingQuantity,
    fees: positiveNumber(form.fees, false),
    reason: "Close trade",
    notes: form.notes,
  };
}

export function buildOpenTradeRows(trades: ManualTrade[]): OpenTradeRow[] {
  return trades
    .flatMap((trade) => {
      const result = calculateTrade(trade);
      if (result.quantityRemaining <= 0) return [];
      return [
        {
          trade,
          dateOpened: trade.entryDate,
          strategySource: sourceForManualTrade(trade),
          ticker: trade.ticker,
          quantityRemaining: result.quantityRemaining,
          entryPrice: trade.entryPrice,
          totalCost: proportionalCost(trade.amountInvested, trade.quantity, result.quantityRemaining),
          fees: trade.fees,
          notes: trade.notes || trade.journal?.entryReason || "",
        },
      ];
    })
    .sort((left, right) => right.dateOpened.localeCompare(left.dateOpened));
}

export function buildClosedTradeRows(trades: ManualTrade[]): ClosedTradeRow[] {
  return trades
    .flatMap((trade) => {
      const result = calculateTrade(trade);
      if (result.quantityRemaining > 0 || trade.exits.length === 0) return [];
      const sortedExits = [...trade.exits].sort((left, right) =>
        right.exitDate.localeCompare(left.exitDate),
      );
      const quantity = trade.exits.reduce((sum, exit) => sum + exit.quantitySold, 0);
      const grossExitValue = trade.exits.reduce(
        (sum, exit) => sum + exit.exitPrice * exit.quantitySold,
        0,
      );
      const exitPrice = quantity > 0 ? grossExitValue / quantity : 0;
      const totalCost = trade.amountInvested;
      const denominator = totalCost + trade.fees;
      return [
        {
          trade,
          dateOpened: trade.entryDate,
          dateClosed: sortedExits[0]?.exitDate ?? trade.entryDate,
          strategySource: sourceForManualTrade(trade),
          ticker: trade.ticker,
          quantity,
          entryPrice: trade.entryPrice,
          exitPrice,
          totalCost,
          totalPnl: result.totalPL,
          pnlPercent: denominator > 0 ? (result.totalPL / denominator) * 100 : 0,
          notes: sortedExits[0]?.notes || sortedExits[0]?.reason || trade.notes,
        },
      ];
    })
    .sort((left, right) => right.dateClosed.localeCompare(left.dateClosed));
}

export function sourceForManualTrade(trade: ManualTrade): StrategySource {
  if (trade.sleeve === "SuperTrend" || /supertrend/i.test(trade.strategyName)) {
    return "Daily SuperTrend";
  }
  if (trade.sleeve === "SMA200 Regime" || /sma200|nasdaq/i.test(trade.strategyName)) {
    return "Nasdaq SMA200";
  }
  return "Manual / Discretionary";
}

export function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00`;
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function sleeveForSource(source: StrategySource) {
  if (source === "Daily SuperTrend") return "SuperTrend";
  if (source === "Nasdaq SMA200") return "SMA200 Regime";
  return "Discretionary / untagged";
}

function sourceForStrategy(strategy: MultiStrategyRecord): StrategySource | null {
  if (strategy.strategyId === "daily-supertrend") return "Daily SuperTrend";
  if (strategy.strategyId === "nasdaq-sma200-3x") return "Nasdaq SMA200";
  return null;
}

function recentActionableEvents(events: MultiStrategyEvent[]) {
  return events.filter(
    (event) => event.eventType === "entry" || event.eventType === "exit",
  );
}

function addOption(
  options: Map<string, SignalActionOption>,
  option: SignalActionOption,
) {
  const key = `${option.group}:${option.strategySource}:${option.ticker}:${option.action}`;
  if (!options.has(key)) options.set(key, option);
}

function groupPriority(group: SignalActionOption["group"]) {
  return group === "recent_event" ? 0 : 1;
}

function positiveNumber(value: string, required = true) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return required ? 0 : 0;
  }
  return number;
}

function proportionalCost(totalCost: number, totalQuantity: number, quantity: number) {
  if (totalQuantity <= 0) return totalCost;
  return totalCost * (quantity / totalQuantity);
}
