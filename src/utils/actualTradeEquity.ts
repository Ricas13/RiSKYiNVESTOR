import type { ManualTrade } from "../types";
import { calculateTrade } from "./manualTrades";

export interface ActualTradeEquityPoint {
  date: string;
  realisedPnl: number;
  estimatedTotalPnl: number | null;
}

export interface ActualTradeEquityModel {
  hasTrades: boolean;
  totalInvested: number;
  realisedPnl: number;
  unrealisedPnl: number | null;
  totalPnl: number;
  openTrades: number;
  closedTrades: number;
  hasUnrealisedEstimate: boolean;
  points: ActualTradeEquityPoint[];
}

interface EquityEvent {
  date: string;
  realisedDelta: number;
}

export function buildActualTradeEquityModel(
  trades: ManualTrade[],
): ActualTradeEquityModel {
  const realTrades = trades.filter((trade) => trade.quantity > 0);
  const analyses = realTrades.map((trade) => ({
    trade,
    result: calculateTrade(trade),
  }));
  const openAnalyses = analyses.filter(
    (item) => item.result.quantityRemaining > 0,
  );
  const closedTrades = analyses.filter(
    (item) => item.result.quantityRemaining <= 0 && item.trade.exits.length > 0,
  ).length;
  const realisedPnl = analyses.reduce(
    (sum, item) => sum + item.result.realisedPL,
    0,
  );
  const unrealisedEstimates = openAnalyses.flatMap((item) => {
    if (!hasUsableCurrentPrice(item.trade)) return [];
    return [item.result.unrealisedPL];
  });
  const hasUnrealisedEstimate = unrealisedEstimates.length > 0;
  const unrealisedPnl = hasUnrealisedEstimate
    ? unrealisedEstimates.reduce((sum, value) => sum + value, 0)
    : null;
  const totalPnl = realisedPnl + (unrealisedPnl ?? 0);

  return {
    hasTrades: realTrades.length > 0,
    totalInvested: realTrades.reduce(
      (sum, trade) => sum + Math.max(0, trade.amountInvested),
      0,
    ),
    realisedPnl,
    unrealisedPnl,
    totalPnl,
    openTrades: openAnalyses.length,
    closedTrades,
    hasUnrealisedEstimate,
    points: buildEquityPoints(realTrades, hasUnrealisedEstimate, totalPnl),
  };
}

function buildEquityPoints(
  trades: ManualTrade[],
  hasUnrealisedEstimate: boolean,
  totalPnl: number,
) {
  if (!trades.length) return [];

  const events: EquityEvent[] = [];
  for (const trade of trades) {
    events.push({ date: trade.entryDate, realisedDelta: 0 });
    const unitCost =
      trade.quantity > 0
        ? (trade.entryPrice * trade.quantity + trade.fees) / trade.quantity
        : 0;
    for (const exit of trade.exits) {
      const proceeds = exit.exitPrice * exit.quantitySold - exit.fees;
      const cost = unitCost * exit.quantitySold;
      events.push({ date: exit.exitDate, realisedDelta: proceeds - cost });
    }
  }

  events.sort((left, right) => left.date.localeCompare(right.date));

  let realisedPnl = 0;
  const points: ActualTradeEquityPoint[] = [];
  for (const event of events) {
    realisedPnl += event.realisedDelta;
    const previous = points.at(-1);
    if (previous && sameCalendarDate(previous.date, event.date)) {
      previous.realisedPnl = realisedPnl;
      continue;
    }
    points.push({
      date: event.date,
      realisedPnl,
      estimatedTotalPnl: hasUnrealisedEstimate ? realisedPnl : null,
    });
  }

  if (hasUnrealisedEstimate && points.length) {
    points[points.length - 1].estimatedTotalPnl = totalPnl;
  }

  return points;
}

function hasUsableCurrentPrice(trade: ManualTrade) {
  return Number.isFinite(trade.currentPrice) && trade.currentPrice > 0;
}

function sameCalendarDate(left: string, right: string) {
  return left.slice(0, 10) === right.slice(0, 10);
}
