import type {
  ManualTrade,
  MultiStrategyEvent,
  MultiStrategyPublicState,
  MultiStrategyRecord,
} from "../types";
import { calculateTrade } from "./manualTrades";

export type StrategySource = "Daily SuperTrend" | "Nasdaq SMA200" | "Manual / Discretionary";
export type SignalActionType = "enter" | "exit";

export interface SignalActionFormState {
  strategySource: StrategySource;
  signalTicker: string;
  executionTicker: string;
  action: SignalActionType;
  actionAt: string;
  price: string;
  amountInvested: string;
  quantity: string;
  fees: string;
  notes: string;
  referenceLink: string;
  riskTier: string;
  assetClass: string;
  isTechnology: string;
  isSingleStock: string;
  leverageMultiplier: string;
  entryReason: string;
  followedSystem: string;
  overrodeSystem: string;
  emotionalState: string;
  checkedChart: string;
  lesson: string;
  source: string;
}

export interface SignalActionOption {
  optionId: string;
  group: "current_pair" | "open_model_position" | "recent_event";
  label: string;
  strategySource: StrategySource;
  signalTicker: string;
  executionTicker: string;
  action: SignalActionType;
  reason: string;
}

export interface JournalActionRow {
  actionId: string;
  trade: ManualTrade;
  exitId: string | null;
  date: string;
  strategySource: StrategySource;
  signalTicker: string;
  executionTicker: string;
  actionLabel: "Buy / Enter" | "Sell / Exit";
  price: number;
  amount: number;
  quantity: number;
  pnl: number | null;
  notes: string;
  referenceLink: string;
  canRecordExit: boolean;
  canEditTrade: boolean;
}

export const emptySignalActionForm = (): SignalActionFormState => ({
  strategySource: "Daily SuperTrend",
  signalTicker: "",
  executionTicker: "",
  action: "enter",
  actionAt: toDateTimeLocal(new Date().toISOString()),
  price: "",
  amountInvested: "",
  quantity: "",
  fees: "0",
  notes: "",
  referenceLink: "",
  riskTier: "CORE",
  assetClass: "Signal action",
  isTechnology: "false",
  isSingleStock: "false",
  leverageMultiplier: "1",
  entryReason: "",
  followedSystem: "true",
  overrodeSystem: "false",
  emotionalState: "",
  checkedChart: "true",
  lesson: "",
  source: "manual",
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

    for (const pair of strategyPairs(strategy)) {
      addOption(options, {
        optionId: `pair:${strategy.strategyId}:${pair.signalTicker}:${pair.executionTicker}`,
        group: "current_pair",
        label: `Current pair · ${source} · ${pair.signalTicker} → ${pair.executionTicker}`,
        strategySource: source,
        signalTicker: pair.signalTicker,
        executionTicker: pair.executionTicker,
        action: "enter",
        reason: "Current scanner ticker pair.",
      });
    }

    for (const position of strategy.virtualPositions) {
      addOption(options, {
        optionId: `position:${position.positionId}`,
        group: "open_model_position",
        label: `Open model position · ${source} · ${position.signalTicker} → ${position.executionTicker}`,
        strategySource: source,
        signalTicker: position.signalTicker,
        executionTicker: position.executionTicker,
        action: "enter",
        reason: position.reason || "Open virtual model position.",
      });
    }

    for (const event of recentActionableEvents(strategy.events)) {
      addOption(options, {
        optionId: `event:${event.eventId}`,
        group: "recent_event",
        label: `Recent ${event.eventType === "exit" ? "exit" : "entry"} · ${source} · ${event.signalTicker} → ${event.executionTicker}`,
        strategySource: source,
        signalTicker: event.signalTicker,
        executionTicker: event.executionTicker,
        action: event.eventType === "exit" ? "exit" : "enter",
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
  form: SignalActionFormState,
  option: SignalActionOption,
): SignalActionFormState {
  return {
    ...form,
    strategySource: option.strategySource,
    signalTicker: option.signalTicker,
    executionTicker: option.executionTicker,
    action: option.action,
    notes: option.reason && !form.notes ? option.reason : form.notes,
    entryReason:
      option.reason && !form.entryReason ? option.reason : form.entryReason,
  };
}

export function buildManualTradePayload(form: SignalActionFormState) {
  const price = positiveNumber(form.price);
  const amountInvested = positiveNumber(form.amountInvested);
  const quantity =
    positiveNumber(form.quantity, false) || amountInvested / Math.max(price, 0.000001);
  const fees = positiveNumber(form.fees, false);
  const signalTicker = form.signalTicker.trim().toUpperCase();
  const executionTicker = form.executionTicker.trim().toUpperCase();

  return {
    strategyName: form.strategySource,
    sleeve: sleeveForSource(form.strategySource),
    assetName: signalTicker,
    ticker: executionTicker,
    direction: "long",
    riskTier: form.riskTier,
    assetClass: form.assetClass || "Signal action",
    isTechnology: form.isTechnology === "true",
    isSingleStock: form.isSingleStock === "true",
    leverageMultiplier: positiveNumber(form.leverageMultiplier, false) || 1,
    entryDate: form.actionAt,
    entryPrice: price,
    quantity,
    amountInvested,
    fees,
    notes: form.notes,
    source: ["manual", "Discord alert", "imported"].includes(form.source)
      ? form.source
      : "manual",
    referenceLink: form.referenceLink,
    currentPrice: price,
    journal: {
      entryReason: form.entryReason || form.notes,
      followedSystem: form.followedSystem === "true",
      overrodeSystem: form.overrodeSystem === "true",
      emotionalState: form.emotionalState,
      checkedChart: form.checkedChart === "true",
      lesson: form.lesson,
    },
  };
}

export function buildManualExitPayload(
  form: SignalActionFormState,
  remainingQuantity: number,
) {
  return {
    exitDate: form.actionAt,
    exitPrice: positiveNumber(form.price),
    quantitySold: positiveNumber(form.quantity, false) || remainingQuantity,
    fees: positiveNumber(form.fees, false),
    reason: form.notes || "Signal exit",
    notes: form.notes,
  };
}

export function buildJournalActionRows(trades: ManualTrade[]): JournalActionRow[] {
  const rows = trades.flatMap((trade) => {
    const result = calculateTrade(trade);
    const entryRow: JournalActionRow = {
      actionId: `${trade.id}:entry`,
      trade,
      exitId: null,
      date: trade.entryDate,
      strategySource: sourceForManualTrade(trade),
      signalTicker: trade.assetName || trade.ticker,
      executionTicker: trade.ticker,
      actionLabel: "Buy / Enter",
      price: trade.entryPrice,
      amount: trade.amountInvested,
      quantity: trade.quantity,
      pnl: result.totalPL,
      notes: trade.notes || trade.journal?.entryReason || "",
      referenceLink: trade.referenceLink,
      canRecordExit: result.quantityRemaining > 0,
      canEditTrade: true,
    };

    const entryUnitCost =
      trade.quantity > 0
        ? (trade.entryPrice * trade.quantity + trade.fees) / trade.quantity
        : 0;
    const exitRows: JournalActionRow[] = trade.exits.map((exit) => {
      const proceeds = exit.exitPrice * exit.quantitySold - exit.fees;
      const cost = entryUnitCost * exit.quantitySold;
      return {
        actionId: `${trade.id}:exit:${exit.id}`,
        trade,
        exitId: exit.id,
        date: exit.exitDate,
        strategySource: sourceForManualTrade(trade),
        signalTicker: trade.assetName || trade.ticker,
        executionTicker: trade.ticker,
        actionLabel: "Sell / Exit",
        price: exit.exitPrice,
        amount: proceeds,
        quantity: exit.quantitySold,
        pnl: proceeds - cost,
        notes: exit.notes || exit.reason,
        referenceLink: "",
        canRecordExit: false,
        canEditTrade: false,
      };
    });

    return [entryRow, ...exitRows];
  });

  return rows.sort((left, right) => right.date.localeCompare(left.date));
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

function strategyPairs(strategy: MultiStrategyRecord) {
  if (strategy.strategyId === "daily-supertrend") {
    const rows = strategy.parameters.watchlist;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((value) => {
      if (!isRecord(value)) return [];
      const signalTicker = textValue(value.signalTicker);
      const executionTicker = textValue(value.executionTicker);
      if (!signalTicker || !executionTicker) return [];
      return [{ signalTicker, executionTicker }];
    });
  }

  const position = strategy.virtualPositions[0];
  const latestEvent = strategy.latestEvent ?? latestEventFrom(strategy.events);
  const signalTicker =
    strategy.referenceTicker ??
    latestEvent?.signalTicker ??
    textValue(strategy.parameters.referenceTicker);
  const executionTicker =
    strategy.executionTicker ??
    position?.executionTicker ??
    latestEvent?.executionTicker ??
    textValue(strategy.parameters.riskOnTicker);
  return signalTicker && executionTicker ? [{ signalTicker, executionTicker }] : [];
}

function recentActionableEvents(events: MultiStrategyEvent[]) {
  return events.filter(
    (event) => event.eventType === "entry" || event.eventType === "exit",
  );
}

function latestEventFrom(events: MultiStrategyEvent[]) {
  return [...events].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt),
  )[0];
}

function addOption(
  options: Map<string, SignalActionOption>,
  option: SignalActionOption,
) {
  const key = `${option.group}:${option.strategySource}:${option.signalTicker}:${option.executionTicker}:${option.action}`;
  if (!options.has(key)) options.set(key, option);
}

function groupPriority(group: SignalActionOption["group"]) {
  if (group === "recent_event") return 0;
  if (group === "open_model_position") return 1;
  return 2;
}

function positiveNumber(value: string, required = true) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    if (required) return 0;
    return 0;
  }
  return number;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
