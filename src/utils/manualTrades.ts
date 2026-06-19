import type { ManualTrade } from "../types";

export function calculateTrade(trade: ManualTrade) {
  const quantitySold = trade.exits.reduce(
    (sum, exit) => sum + exit.quantitySold,
    0,
  );
  const quantityRemaining = Math.max(0, trade.quantity - quantitySold);
  const entryUnitCost =
    trade.quantity > 0
      ? (trade.entryPrice * trade.quantity + trade.fees) / trade.quantity
      : 0;
  const realisedProceeds = trade.exits.reduce(
    (sum, exit) => sum + exit.exitPrice * exit.quantitySold - exit.fees,
    0,
  );
  const realisedCost = entryUnitCost * quantitySold;
  const realisedPL = realisedProceeds - realisedCost;
  const realisedPLPercent =
    realisedCost > 0 ? (realisedPL / realisedCost) * 100 : 0;
  const openPositionValue = quantityRemaining * trade.currentPrice;
  const openCost = quantityRemaining * entryUnitCost;
  const unrealisedPL = openPositionValue - openCost;
  const unrealisedPLPercent = openCost > 0 ? (unrealisedPL / openCost) * 100 : 0;
  const totalPL = realisedPL + unrealisedPL;
  const totalReturnPercent =
    trade.amountInvested > 0 ? (totalPL / trade.amountInvested) * 100 : 0;
  const endDate =
    quantityRemaining <= 0 && trade.exits.length
      ? trade.exits.reduce(
          (latest, exit) => (exit.exitDate > latest ? exit.exitDate : latest),
          trade.entryDate,
        )
      : new Date().toISOString().slice(0, 10);
  const holdingDays = Math.max(
    0,
    Math.round(
      (new Date(endDate).getTime() - new Date(trade.entryDate).getTime()) /
        86_400_000,
    ),
  );

  return {
    quantitySold,
    quantityRemaining,
    realisedPL,
    realisedPLPercent,
    openPositionValue,
    unrealisedPL,
    unrealisedPLPercent,
    totalPL,
    totalReturnPercent,
    holdingDays,
    status:
      quantityRemaining > 0 ? "Open" : totalPL >= 0 ? "Win" : "Loss",
  };
}
