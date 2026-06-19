import { Info, Target } from "lucide-react";
import type { OpenTrade } from "../types";
import { formatDate, formatNumber } from "../utils/format";
import { TierBadge } from "./ui";

export function OpenPositionsTable({ trades }: { trades: OpenTrade[] }) {
  return (
    <div className="panel">
      <div className="panel-note">
        <Info size={16} />
        Reference prices are daily signal closes, not live quotes or Trading 212 fills.
      </div>
      <div className="table-scroll">
        <table className="data-table positions-table">
          <thead>
            <tr>
              <th>Position</th>
              <th>Open alert</th>
              <th>Reference prices</th>
              <th>Model P/L</th>
              <th>Risk / allocation</th>
              <th>Take profit</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id}>
                <td data-label="Position">
                  <strong className="table-primary">{trade.assetName}</strong>
                  <span className="table-secondary">
                    {trade.entryTicker} → {trade.tradeTicker}
                  </span>
                </td>
                <td data-label="Open alert">{formatDate(trade.openAlertDate)}</td>
                <td data-label="Prices">
                  <strong className="table-primary">
                    £{formatNumber(trade.referenceOpenPrice)} → £
                    {formatNumber(trade.currentReferencePrice)}
                  </strong>
                  <span className="table-secondary">Open → latest close</span>
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
                <td data-label="Risk">
                  <TierBadge tier={trade.riskTier} />
                  <span className="table-secondary">{trade.allocationPercent}% model allocation</span>
                </td>
                <td data-label="Take profit">
                  <span className="take-profit">
                    <Target size={15} />
                    {trade.takeProfitStatus}
                  </span>
                </td>
                <td data-label="Notes">
                  <span className="table-note">{trade.notes}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
