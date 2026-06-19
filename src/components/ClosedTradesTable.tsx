import type { ClosedTrade } from "../types";
import { formatDate, formatNumber } from "../utils/format";
import { TierBadge } from "./ui";

export function ClosedTradesTable({ trades }: { trades: ClosedTrade[] }) {
  return (
    <div className="panel closed-trades-panel">
      <div className="panel-title-row">
        <div>
          <span>Recent history</span>
          <h3>Closed model trades</h3>
        </div>
        <span>{trades.length} shown</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Period</th>
              <th>Reference prices</th>
              <th>Model P/L</th>
              <th>Outcome</th>
              <th>Risk tier</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id}>
                <td data-label="Asset">
                  <strong className="table-primary">{trade.assetName}</strong>
                  <span className="table-secondary">{trade.tradeTicker}</span>
                </td>
                <td data-label="Period">
                  {formatDate(trade.openDate)} – {formatDate(trade.closeDate)}
                </td>
                <td data-label="Prices">
                  £{formatNumber(trade.entryPrice)} → £{formatNumber(trade.exitPrice)}
                </td>
                <td data-label="Model P/L">
                  <strong
                    className={
                      trade.modelPLPercent >= 0 ? "pl-value pl-value--up" : "pl-value pl-value--down"
                    }
                  >
                    {trade.modelPLPercent >= 0 ? "+" : ""}
                    {formatNumber(trade.modelPLPercent)}%
                  </strong>
                </td>
                <td data-label="Outcome">
                  <span className={`outcome outcome--${trade.outcome.toLowerCase()}`}>
                    {trade.outcome}
                  </span>
                </td>
                <td data-label="Risk">
                  <TierBadge tier={trade.riskTier} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
