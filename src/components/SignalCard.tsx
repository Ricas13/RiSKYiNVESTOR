import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  TriangleAlert,
} from "lucide-react";
import type { Signal } from "../types";
import { formatDate, formatNumber } from "../utils/format";
import { Badge, TierBadge } from "./ui";

export function SignalCard({
  signal,
  confidence,
}: {
  signal: Signal;
  confidence?: {
    label: string;
    tone: "green" | "red" | "amber" | "blue" | "purple";
  };
}) {
  const isEntry = signal.signalType === "ENTRY";
  const isExit = signal.signalType === "EXIT";
  const Icon = isEntry ? ArrowUpRight : isExit ? ArrowDownRight : Coins;
  const tone = isEntry ? "green" : isExit ? "red" : "amber";

  return (
    <article className={`signal-card signal-card--${tone}`}>
      <div className="signal-card__accent" aria-hidden="true" />
      <div className="signal-card__header">
        <div className={`signal-icon signal-icon--${tone}`}>
          <Icon size={21} />
        </div>
        <div>
          <div className="signal-title-line">
            <h3>{signal.title}</h3>
            <Badge tone={tone}>{signal.signalType}</Badge>
            {confidence && <Badge tone={confidence.tone}>{confidence.label}</Badge>}
          </div>
          <p>
            {signal.assetName} · {formatDate(signal.signalDate)}
          </p>
        </div>
      </div>

      <div className="signal-route">
        <div>
          <span>Underlying signal</span>
          <strong>{signal.underlyingTicker}</strong>
        </div>
        <span className="signal-route__line" aria-hidden="true">
          <i />
        </span>
        <div>
          <span>Trade / exit ticker</span>
          <strong>{signal.tradeTicker}</strong>
        </div>
      </div>

      <div className="signal-action">
        <CheckCircle2 size={17} />
        <div>
          <span>Suggested action</span>
          <strong>{signal.suggestedAction}</strong>
        </div>
      </div>

      <dl className="signal-stats">
        <div>
          <dt>Risk tier</dt>
          <dd>
            <TierBadge tier={signal.riskTier} />
          </dd>
        </div>
        <div>
          <dt>Allocation</dt>
          <dd>{signal.suggestedAllocation}</dd>
        </div>
        <div>
          <dt>Reference close</dt>
          <dd>
            {signal.currency === "GBP" ? "£" : "$"}
            {formatNumber(signal.referenceClose)}
          </dd>
        </div>
        <div>
          <dt>SuperTrend</dt>
          <dd>{formatNumber(signal.superTrendValue)}</dd>
        </div>
      </dl>

      {signal.liquidityWarning && (
        <div className="signal-warning">
          <TriangleAlert size={16} />
          {signal.liquidityWarning}
        </div>
      )}
    </article>
  );
}
