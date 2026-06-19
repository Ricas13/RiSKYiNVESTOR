import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Coins,
  Eye,
  TriangleAlert,
} from "lucide-react";
import type {
  ArchivedSignal,
  DashboardSettings,
  OpenTrade,
  Signal,
  SignalDecision,
  StrategyDefinition,
  WatchlistItem,
  WealthSnapshot,
} from "../types";
import { signalConfidence } from "../utils/signalConfidence";
import { Badge } from "./ui";

export function TodaysActions({
  signals,
  archive,
  decisions,
  openTrades,
  watchlist,
  strategies,
  snapshots,
  settings,
}: {
  signals: Signal[];
  archive: ArchivedSignal[];
  decisions: SignalDecision[];
  openTrades: OpenTrade[];
  watchlist: WatchlistItem[];
  strategies: StrategyDefinition[];
  snapshots: WealthSnapshot[];
  settings: DashboardSettings;
}) {
  const decisionMap = new Map(decisions.map((item) => [item.signalId, item]));
  const actionable = signals.filter(
    (signal) => decisionMap.get(signal.id)?.status !== "Taken",
  );
  const liquidity = watchlist.filter(
    (item) =>
      item.liquidityStatus !== "Good" &&
      (item.currentTrend === "Green" ||
        openTrades.some((trade) => trade.tradeTicker === item.tradeTicker)),
  );

  if (!actionable.length && !liquidity.length) {
    return (
      <div className="no-action-state">
        <CheckCircle2 size={28} />
        <div>
          <strong>No new entry/exit flips today.</strong>
          <p>Your open positions still need their normal manual review.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="action-page-grid">
      <div className="action-feed">
        {actionable.map((signal) => {
          const archived =
            archive.find((item) => item.id === signal.id) ??
            ({ ...signal, modelExitDate: null, modelExitPrice: null } as ArchivedSignal);
          const confidence = signalConfidence(
            archived,
            watchlist,
            strategies,
            snapshots,
            settings,
          );
          const Icon =
            signal.signalType === "ENTRY"
              ? ArrowUpRight
              : signal.signalType === "EXIT"
                ? ArrowDownRight
                : Coins;
          return (
            <article className="action-card" key={signal.id}>
              <span className={`action-card__icon action-card__icon--${confidence.tone}`}>
                <Icon size={21} />
              </span>
              <div>
                <div className="action-card__badges">
                  <Badge
                    tone={
                      signal.signalType === "ENTRY"
                        ? "green"
                        : signal.signalType === "EXIT"
                          ? "red"
                          : "amber"
                    }
                  >
                    {signal.signalType}
                  </Badge>
                  <Badge tone={confidence.tone}>{confidence.label}</Badge>
                </div>
                <h3>
                  Action required: {signal.signalType === "ENTRY" ? "BUY" : signal.signalType}{" "}
                  {signal.tradeTicker}
                </h3>
                <p>{signal.suggestedAction}.</p>
                <small>
                  {signal.riskTier.toLowerCase()} tier · {signal.suggestedAllocation}
                </small>
              </div>
            </article>
          );
        })}
      </div>

      <aside className="review-panel">
        <div className="review-panel__heading">
          <Eye size={18} />
          <div>
            <span>Manual review</span>
            <strong>{openTrades.length} model positions open</strong>
          </div>
        </div>
        {liquidity.map((item) => (
          <div className="review-item" key={item.id}>
            <TriangleAlert size={15} />
            <p>
              <strong>{item.tradeTicker}</strong> liquidity is{" "}
              {item.liquidityStatus.toLowerCase()}. Check the live spread.
            </p>
          </div>
        ))}
        {!liquidity.length && (
          <div className="review-item">
            <CircleAlert size={15} />
            <p>No elevated liquidity warnings on currently relevant assets.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
