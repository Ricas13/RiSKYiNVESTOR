import { Search, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import type { RiskTier, WatchlistItem } from "../types";
import { formatDate, formatNumber } from "../utils/format";
import {
  LiquidityBadge,
  TierBadge,
  TrendBadge,
} from "./ui";

const tiers: Array<"ALL" | RiskTier> = [
  "ALL",
  "CORE",
  "AGGRESSIVE",
  "SPECULATIVE",
  "EXCLUDED",
];

export function WatchlistTable({ items }: { items: WatchlistItem[] }) {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<(typeof tiers)[number]>("ALL");

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const matchesTier = tier === "ALL" || item.riskTier === tier;
        const haystack =
          `${item.assetName} ${item.category} ${item.entryTicker} ${item.tradeTicker}`.toLowerCase();
        return matchesTier && haystack.includes(query.toLowerCase());
      }),
    [items, query, tier],
  );

  return (
    <div className="panel">
      <div className="table-toolbar">
        <label className="search-field">
          <Search size={17} />
          <span className="sr-only">Search watchlist</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search asset or ticker"
          />
        </label>
        <label className="filter-field">
          <SlidersHorizontal size={17} />
          <span className="sr-only">Filter by risk tier</span>
          <select
            value={tier}
            onChange={(event) => setTier(event.target.value as (typeof tiers)[number])}
          >
            {tiers.map((value) => (
              <option key={value} value={value}>
                {value === "ALL" ? "All risk tiers" : value}
              </option>
            ))}
          </select>
        </label>
        <span className="result-count">{filtered.length} instruments</span>
      </div>

      <div className="table-scroll">
        <table className="data-table watchlist-table">
          <thead>
            <tr>
              <th>Asset / category</th>
              <th>Tickers</th>
              <th>Risk tier</th>
              <th>Trend</th>
              <th>Close / SuperTrend</th>
              <th>Last signal</th>
              <th>Liquidity</th>
              <th>Allocation / notes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td data-label="Asset">
                  <strong className="table-primary">{item.assetName}</strong>
                  <span className="table-secondary">{item.category}</span>
                </td>
                <td data-label="Tickers">
                  <div className="ticker-pair">
                    <span>
                      <small>ENTRY</small>
                      <strong>{item.entryTicker}</strong>
                    </span>
                    <span className="ticker-arrow">→</span>
                    <span>
                      <small>TRADE</small>
                      <strong>{item.tradeTicker}</strong>
                    </span>
                  </div>
                </td>
                <td data-label="Risk">
                  <TierBadge tier={item.riskTier} />
                </td>
                <td data-label="Trend">
                  <TrendBadge trend={item.currentTrend} />
                </td>
                <td data-label="Price">
                  <strong className="table-primary">
                    {item.currency === "GBP" ? "£" : "$"}
                    {formatNumber(item.latestClose)}
                  </strong>
                  <span className="table-secondary">
                    ST {formatNumber(item.superTrendValue)}
                  </span>
                </td>
                <td data-label="Last signal">{formatDate(item.lastSignalDate)}</td>
                <td data-label="Liquidity">
                  <LiquidityBadge liquidity={item.liquidityStatus} />
                  {item.liquidityStatus !== "Good" && (
                    <span className="warning-copy">
                      <TriangleAlert size={13} /> Check spread
                    </span>
                  )}
                </td>
                <td data-label="Allocation">
                  <strong className="table-primary">{item.allocationRule}</strong>
                  <span className="table-secondary table-note">{item.notes}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
