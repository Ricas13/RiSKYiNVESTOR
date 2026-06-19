import { Link2, Save, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ArchivedSignal,
  ManualTrade,
  SignalDecision,
  SignalDecisionStatus,
} from "../types";
import { formatDate, formatMoney, formatNumber } from "../utils/format";
import { calculateTrade } from "../utils/manualTrades";
import { Badge } from "./ui";

const statuses: SignalDecisionStatus[] = [
  "Taken",
  "Skipped",
  "Missed",
  "Ignored due to risk",
  "Entered late",
  "Exited manually",
  "Partially taken",
  "Paper only",
];

interface Draft {
  status: SignalDecisionStatus;
  manualTradeId: string;
  notes: string;
  assumedStake: string;
}

export function SignalComparison({
  signals,
  decisions,
  trades,
  assumedStake,
  mutate,
}: {
  signals: ArchivedSignal[];
  decisions: SignalDecision[];
  trades: ManualTrade[];
  assumedStake: number;
  mutate: (
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body?: unknown,
  ) => Promise<unknown>;
}) {
  const decisionMap = useMemo(
    () => new Map(decisions.map((item) => [item.signalId, item])),
    [decisions],
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const rows = signals.map((signal) => {
    const decision = decisionMap.get(signal.id);
    const trade = trades.find((item) => item.id === decision?.manualTradeId);
    const actual = trade ? calculateTrade(trade) : null;
    const modelReturn =
      signal.modelExitPrice && signal.referenceClose
        ? ((signal.modelExitPrice - signal.referenceClose) /
            signal.referenceClose) *
          100
        : null;
    const stake = decision?.assumedStake ?? assumedStake;
    const missedPL = modelReturn === null ? null : (stake * modelReturn) / 100;
    return { signal, decision, trade, actual, modelReturn, missedPL };
  });

  const takenStatuses = new Set<SignalDecisionStatus>([
    "Taken",
    "Entered late",
    "Exited manually",
    "Partially taken",
  ]);
  const taken = rows.filter(
    ({ decision }) => decision && takenStatuses.has(decision.status),
  );
  const skipped = rows.filter(({ decision }) => decision?.status === "Skipped");
  const missed = rows.filter(({ decision }) => decision?.status === "Missed");
  const actualPL = taken.reduce(
    (sum, item) => sum + (item.actual?.realisedPL ?? 0),
    0,
  );
  const missedPL = rows
    .filter(({ decision }) =>
      ["Skipped", "Missed", "Ignored due to risk"].includes(
        decision?.status ?? "",
      ),
    )
    .reduce((sum, item) => sum + (item.missedPL ?? 0), 0);
  const missedClosed = rows.filter(
    ({ decision, modelReturn }) =>
      modelReturn !== null &&
      ["Skipped", "Missed", "Ignored due to risk"].includes(
        decision?.status ?? "",
      ),
  );
  const missedWinners = missedClosed.filter(
    ({ modelReturn }) => (modelReturn ?? 0) > 0,
  );
  const missedLosers = missedClosed.filter(
    ({ modelReturn }) => (modelReturn ?? 0) < 0,
  );
  const bestMissed = [...missedWinners].sort(
    (a, b) => (b.missedPL ?? 0) - (a.missedPL ?? 0),
  )[0];
  const worstAvoided = [...missedLosers].sort(
    (a, b) => (a.missedPL ?? 0) - (b.missedPL ?? 0),
  )[0];
  const modelPL = taken.reduce(
    (sum, item) =>
      sum +
      ((item.modelReturn ?? 0) *
        (item.trade?.amountInvested ?? item.decision?.assumedStake ?? assumedStake)) /
        100,
    0,
  );

  function draftFor(signalId: string): Draft {
    if (drafts[signalId]) return drafts[signalId];
    const decision = decisionMap.get(signalId);
    return {
      status: decision?.status ?? "Missed",
      manualTradeId: decision?.manualTradeId ?? "",
      notes: decision?.notes ?? "",
      assumedStake: String(decision?.assumedStake ?? assumedStake),
    };
  }

  function updateDraft(signalId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [signalId]: { ...draftFor(signalId), ...patch },
    }));
  }

  async function save(signalId: string) {
    const draft = draftFor(signalId);
    setSaving(signalId);
    setMessage("");
    try {
      await mutate(`/signal-decisions/${signalId}`, "PUT", {
        ...draft,
        manualTradeId: draft.manualTradeId || null,
        assumedStake: Number(draft.assumedStake),
      });
      setMessage("Signal decision saved.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Decision could not be saved.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="comparison-stack">
      <div className="comparison-metrics">
        <Metric label="Signals taken" value={String(taken.length)} tone="green" />
        <Metric label="Signals skipped" value={String(skipped.length)} tone="amber" />
        <Metric label="Signals missed" value={String(missed.length)} tone="red" />
        <Metric label="P/L from taken signals" value={formatMoney(actualPL)} tone={actualPL >= 0 ? "green" : "red"} />
        <Metric label="Net missed opportunity" value={formatMoney(missedPL)} tone={missedPL <= 0 ? "green" : "amber"} />
        <Metric label="Manual value added / lost" value={formatMoney(actualPL - modelPL)} tone={actualPL - modelPL >= 0 ? "green" : "red"} />
        <Metric label="Missed winners" value={String(missedWinners.length)} tone="amber" />
        <Metric label="Missed losers / avoided" value={String(missedLosers.length)} tone="green" />
        <Metric label="Best missed trade" value={bestMissed ? `${bestMissed.signal.tradeTicker} · ${formatMoney(bestMissed.missedPL ?? 0)}` : "None"} tone="amber" />
        <Metric label="Worst avoided trade" value={worstAvoided ? `${worstAvoided.signal.tradeTicker} · ${formatMoney(worstAvoided.missedPL ?? 0)}` : "None"} tone="green" />
      </div>

      {message && <div className="form-message comparison-message">{message}</div>}

      <div className="signal-decision-list">
        {rows.map(({ signal, decision, trade, actual, modelReturn, missedPL: rowMissed }) => {
          const draft = draftFor(signal.id);
          const latestExit = trade
            ? [...trade.exits].sort((a, b) => b.exitDate.localeCompare(a.exitDate))[0]
            : undefined;
          const returnDifference =
            actual && modelReturn !== null
              ? actual.totalReturnPercent - modelReturn
              : null;
          return (
            <article className="signal-decision-card" key={signal.id}>
              <div className="signal-decision-card__summary">
                <div>
                  <div className="signal-card__badges">
                    <Badge tone={signal.signalType === "ENTRY" ? "green" : signal.signalType === "EXIT" ? "red" : "amber"}>
                      {signal.signalType}
                    </Badge>
                    <Badge tone="blue">{signal.riskTier}</Badge>
                  </div>
                  <h3>{signal.tradeTicker} · {signal.title}</h3>
                  <p>{signal.strategyName ?? "Baseline Adaptive SuperTrend"} · {formatDate(signal.signalDate)}</p>
                </div>
                <div className="decision-return">
                  {modelReturn === null ? (
                    <span>Model trade open</span>
                  ) : (
                    <>
                      {modelReturn >= 0 ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
                      <strong>{modelReturn >= 0 ? "+" : ""}{formatNumber(modelReturn)}%</strong>
                      <span>{formatMoney(rowMissed ?? 0)} at assumed stake</span>
                    </>
                  )}
                </div>
              </div>

              <dl className="decision-facts">
                <div><dt>Signal price</dt><dd>{formatMoney(signal.referenceClose)}</dd></div>
                <div><dt>Suggested allocation</dt><dd>{signal.suggestedAllocation}</dd></div>
                <div><dt>Linked actual entry</dt><dd>{trade ? `${formatDate(trade.entryDate)} · ${formatMoney(trade.entryPrice)}` : "Not linked"}</dd></div>
                <div><dt>Actual exit</dt><dd>{latestExit ? `${formatDate(latestExit.exitDate)} · ${formatMoney(latestExit.exitPrice)}` : "Open / none"}</dd></div>
                <div><dt>Actual realised P/L</dt><dd>{formatMoney(actual?.realisedPL ?? 0)}</dd></div>
                <div><dt>Actual vs model</dt><dd>{returnDifference === null ? "Pending" : `${returnDifference >= 0 ? "+" : ""}${formatNumber(returnDifference)} pts`}</dd></div>
              </dl>

              <div className="decision-editor">
                <label className="field">
                  <span>Decision status</span>
                  <select value={draft.status} onChange={(event) => updateDraft(signal.id, { status: event.target.value as SignalDecisionStatus })}>
                    {statuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Link actual trade</span>
                  <select value={draft.manualTradeId} onChange={(event) => updateDraft(signal.id, { manualTradeId: event.target.value })}>
                    <option value="">No linked trade</option>
                    {trades.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.ticker} · {formatDate(item.entryDate)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Assumed missed stake (£)</span>
                  <input type="number" min="0" step="0.01" value={draft.assumedStake} onChange={(event) => updateDraft(signal.id, { assumedStake: event.target.value })} />
                </label>
                <label className="field decision-notes">
                  <span>Why taken / skipped?</span>
                  <input value={draft.notes} onChange={(event) => updateDraft(signal.id, { notes: event.target.value })} />
                </label>
                <button className="button button--secondary decision-save" onClick={() => save(signal.id)} disabled={saving === signal.id}>
                  {draft.manualTradeId ? <Link2 size={15} /> : <Save size={15} />} Save
                </button>
              </div>
              {decision?.status && <small className="decision-updated">Current status: {decision.status}</small>}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "red" | "amber";
}) {
  return (
    <article className={`comparison-metric comparison-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
