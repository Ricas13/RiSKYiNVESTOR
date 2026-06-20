import {
  ExternalLink,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { ManualTrade, StrategyDefinition } from "../types";
import { formatDate, formatMoney, formatNumber } from "../utils/format";
import { calculateTrade } from "../utils/manualTrades";
import { Badge } from "./ui";

const today = () => new Date().toISOString().slice(0, 10);

const emptyTrade = {
  strategyName: "Baseline Adaptive SuperTrend",
  sleeve: "Discretionary / untagged",
  assetName: "",
  ticker: "",
  direction: "long",
  riskTier: "CORE",
  assetClass: "US Index",
  isTechnology: "false",
  isSingleStock: "false",
  leverageMultiplier: "3",
  entryDate: today(),
  entryPrice: "",
  quantity: "",
  amountInvested: "",
  fees: "0",
  notes: "",
  source: "manual",
  referenceLink: "",
  currentPrice: "",
  entryReason: "",
  followedSystem: "true",
  overrodeSystem: "false",
  emotionalState: "Disciplined",
  checkedChart: "true",
  lesson: "",
};

type TradeForm = typeof emptyTrade;

export function ManualTrades({
  trades,
  strategies,
  isExample,
  mutate,
}: {
  trades: ManualTrade[];
  strategies: StrategyDefinition[];
  isExample: boolean;
  mutate: (
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body?: unknown,
  ) => Promise<unknown>;
}) {
  const [form, setForm] = useState<TradeForm>(emptyTrade);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exitTrade, setExitTrade] = useState<ManualTrade | null>(null);
  const [exitForm, setExitForm] = useState({
    exitDate: today(),
    exitPrice: "",
    quantitySold: "",
    fees: "0",
    reason: "Exit signal",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const calculated = useMemo(
    () => trades.map((trade) => ({ trade, result: calculateTrade(trade) })),
    [trades],
  );
  const open = calculated.filter((item) => item.result.quantityRemaining > 0);
  const closed = calculated.filter((item) => item.result.quantityRemaining <= 0);
  const followed = calculated.filter(
    ({ trade }) => trade.journal?.followedSystem,
  );
  const overridden = calculated.filter(
    ({ trade }) => trade.journal?.overrodeSystem,
  );
  const followedPL = followed.reduce((sum, item) => sum + item.result.totalPL, 0);
  const overriddenPL = overridden.reduce(
    (sum, item) => sum + item.result.totalPL,
    0,
  );

  function updateField(name: keyof TradeForm, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function resetForm() {
    setForm({ ...emptyTrade, entryDate: today() });
    setEditingId(null);
  }

  function beginEdit(trade: ManualTrade) {
    setEditingId(trade.id);
    setForm({
      strategyName: trade.strategyName,
      sleeve: trade.sleeve ?? "Discretionary / untagged",
      assetName: trade.assetName,
      ticker: trade.ticker,
      direction: trade.direction,
      riskTier: trade.riskTier ?? "CORE",
      assetClass: trade.assetClass ?? "Other",
      isTechnology: String(trade.isTechnology ?? false),
      isSingleStock: String(trade.isSingleStock ?? false),
      leverageMultiplier: String(trade.leverageMultiplier ?? 1),
      entryDate: trade.entryDate,
      entryPrice: String(trade.entryPrice),
      quantity: String(trade.quantity),
      amountInvested: String(trade.amountInvested),
      fees: String(trade.fees),
      notes: trade.notes,
      source: trade.source,
      referenceLink: trade.referenceLink,
      currentPrice: String(trade.currentPrice),
      entryReason: trade.journal?.entryReason ?? "",
      followedSystem: String(trade.journal?.followedSystem ?? false),
      overrodeSystem: String(trade.journal?.overrodeSystem ?? false),
      emotionalState: trade.journal?.emotionalState ?? "",
      checkedChart: String(trade.journal?.checkedChart ?? false),
      lesson: trade.journal?.lesson ?? "",
    });
    document.querySelector("#trade-entry")?.scrollIntoView({ behavior: "smooth" });
  }

  async function submitTrade(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const body = {
        ...form,
        entryPrice: Number(form.entryPrice),
        quantity: Number(form.quantity),
        amountInvested: Number(form.amountInvested),
        fees: Number(form.fees),
        currentPrice: Number(form.currentPrice || form.entryPrice),
        isTechnology: form.isTechnology === "true",
        isSingleStock: form.isSingleStock === "true",
        leverageMultiplier: Number(form.leverageMultiplier),
        journal: {
          entryReason: form.entryReason,
          followedSystem: form.followedSystem === "true",
          overrodeSystem: form.overrodeSystem === "true",
          emotionalState: form.emotionalState,
          checkedChart: form.checkedChart === "true",
          lesson: form.lesson,
        },
      };
      await mutate(
        editingId ? `/manual-trades/${editingId}` : "/manual-trades",
        editingId ? "PUT" : "POST",
        body,
      );
      setMessage(editingId ? "Trade updated." : "Trade entry added.");
      resetForm();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Trade could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTrade(trade: ManualTrade) {
    if (
      !window.confirm(
        `Delete ${trade.ticker} and all of its recorded exits? This cannot be undone.`,
      )
    ) {
      return;
    }
    await mutate(`/manual-trades/${trade.id}`, "DELETE");
  }

  function beginExit(trade: ManualTrade) {
    const remaining = calculateTrade(trade).quantityRemaining;
    setExitTrade(trade);
    setExitForm({
      exitDate: today(),
      exitPrice: String(trade.currentPrice),
      quantitySold: String(remaining),
      fees: "0",
      reason: "Exit signal",
      notes: "",
    });
  }

  async function submitExit(event: FormEvent) {
    event.preventDefault();
    if (!exitTrade) return;
    setBusy(true);
    setMessage("");
    try {
      await mutate(`/manual-trades/${exitTrade.id}/exits`, "POST", {
        ...exitForm,
        exitPrice: Number(exitForm.exitPrice),
        quantitySold: Number(exitForm.quantitySold),
        fees: Number(exitForm.fees),
      });
      setMessage("Exit recorded.");
      setExitTrade(null);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Exit could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteExit(tradeId: string, exitId: string) {
    if (!window.confirm("Delete this exit record? This cannot be undone.")) return;
    await mutate(`/manual-trades/${tradeId}/exits/${exitId}`, "DELETE");
  }

  return (
    <div className="manual-trades-stack">
      {isExample && (
        <div className="example-banner">
          <Badge tone="amber">FAKE SAMPLE DATA</Badge>
          These records demonstrate the interface only. Adding your first trade replaces
          example mode.
        </div>
      )}

      <form className="entry-form panel" id="trade-entry" onSubmit={submitTrade}>
        <div className="form-heading">
          <div>
            <span>{editingId ? "Edit entry" : "Quick mobile entry"}</span>
            <h3>{editingId ? "Update manual trade" : "Record a real trade entry"}</h3>
          </div>
          {editingId && (
            <button type="button" className="icon-button" onClick={resetForm}>
              <X size={17} />
              <span className="sr-only">Cancel edit</span>
            </button>
          )}
        </div>
        <div className="form-grid">
          <label className="field field--wide">
            <span>Strategy name</span>
            <select
              value={form.strategyName}
              onChange={(event) => updateField("strategyName", event.target.value)}
            >
              {strategies.map((strategy) => (
                <option key={strategy.id}>{strategy.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Actual trade sleeve</span>
            <select
              value={form.sleeve}
              onChange={(event) => updateField("sleeve", event.target.value)}
            >
              <option>SuperTrend</option>
              <option>SMA200 Regime</option>
              <option>Discretionary / untagged</option>
            </select>
          </label>
          <label className="field">
            <span>Risk tier</span>
            <select
              value={form.riskTier}
              onChange={(event) => updateField("riskTier", event.target.value)}
            >
              <option>CORE</option>
              <option>AGGRESSIVE</option>
              <option>SPECULATIVE</option>
              <option>EXCLUDED</option>
            </select>
          </label>
          <label className="field">
            <span>Asset class</span>
            <select
              value={form.assetClass}
              onChange={(event) => updateField("assetClass", event.target.value)}
            >
              <option>US Index</option>
              <option>Global Index</option>
              <option>UK Equity</option>
              <option>Single Stock</option>
              <option>Commodity</option>
              <option>Thematic ETF</option>
              <option>Crypto Equity</option>
              <option>Cash</option>
              <option>Other</option>
            </select>
          </label>
          <label className="field">
            <span>Technology exposure?</span>
            <select
              value={form.isTechnology}
              onChange={(event) => updateField("isTechnology", event.target.value)}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </label>
          <label className="field">
            <span>Single-stock exposure?</span>
            <select
              value={form.isSingleStock}
              onChange={(event) => updateField("isSingleStock", event.target.value)}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </label>
          <label className="field">
            <span>Leverage multiplier</span>
            <select
              value={form.leverageMultiplier}
              onChange={(event) =>
                updateField("leverageMultiplier", event.target.value)
              }
            >
              <option value="1">1× / unleveraged</option>
              <option value="2">2×</option>
              <option value="3">3×</option>
            </select>
          </label>
          <label className="field">
            <span>Asset / instrument</span>
            <input
              required
              value={form.assetName}
              onChange={(event) => updateField("assetName", event.target.value)}
              placeholder="Nasdaq 100 3x"
            />
          </label>
          <label className="field">
            <span>Ticker</span>
            <input
              required
              value={form.ticker}
              onChange={(event) => updateField("ticker", event.target.value)}
              placeholder="QQQ3.L"
            />
          </label>
          <label className="field">
            <span>Direction</span>
            <select
              value={form.direction}
              onChange={(event) => updateField("direction", event.target.value)}
            >
              <option value="long">Long</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field">
            <span>Entry date</span>
            <input
              required
              type="date"
              value={form.entryDate}
              onChange={(event) => updateField("entryDate", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Entry price (£)</span>
            <input
              required
              type="number"
              min="0.000001"
              step="any"
              inputMode="decimal"
              value={form.entryPrice}
              onChange={(event) => updateField("entryPrice", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Quantity</span>
            <input
              required
              type="number"
              min="0.000001"
              step="any"
              inputMode="decimal"
              value={form.quantity}
              onChange={(event) => updateField("quantity", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Amount invested (£)</span>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.amountInvested}
              onChange={(event) => updateField("amountInvested", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Entry fees (£)</span>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.fees}
              onChange={(event) => updateField("fees", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Current reference price (£)</span>
            <input
              type="number"
              min="0.000001"
              step="any"
              inputMode="decimal"
              value={form.currentPrice}
              onChange={(event) => updateField("currentPrice", event.target.value)}
              placeholder="Defaults to entry price"
            />
          </label>
          <label className="field">
            <span>Source</span>
            <select
              value={form.source}
              onChange={(event) => updateField("source", event.target.value)}
            >
              <option value="manual">Manual</option>
              <option value="Discord alert">Discord alert</option>
              <option value="imported">Imported</option>
            </select>
          </label>
          <label className="field field--wide">
            <span>Optional screenshot / link</span>
            <input
              type="url"
              value={form.referenceLink}
              onChange={(event) => updateField("referenceLink", event.target.value)}
              placeholder="https://…"
            />
          </label>
          <label className="field field--full">
            <span>Notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              rows={3}
            />
          </label>
          <div className="form-subheading field--full">
            <span>Notes and emotion journal</span>
            <strong>Capture the decision, not just the fill</strong>
          </div>
          <label className="field field--wide">
            <span>Why did I enter?</span>
            <textarea
              value={form.entryReason}
              onChange={(event) => updateField("entryReason", event.target.value)}
              rows={3}
            />
          </label>
          <label className="field">
            <span>Emotional state</span>
            <select
              value={form.emotionalState}
              onChange={(event) =>
                updateField("emotionalState", event.target.value)
              }
            >
              <option>Disciplined</option>
              <option>Calm</option>
              <option>Scared</option>
              <option>Greedy</option>
              <option>Impatient</option>
              <option>Cautious</option>
              <option>Confident</option>
            </select>
          </label>
          <label className="field">
            <span>Followed the system?</span>
            <select
              value={form.followedSystem}
              onChange={(event) =>
                updateField("followedSystem", event.target.value)
              }
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label className="field">
            <span>Overrode the system?</span>
            <select
              value={form.overrodeSystem}
              onChange={(event) =>
                updateField("overrodeSystem", event.target.value)
              }
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </label>
          <label className="field">
            <span>Checked the chart first?</span>
            <select
              value={form.checkedChart}
              onChange={(event) => updateField("checkedChart", event.target.value)}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label className="field field--wide">
            <span>What would I do differently?</span>
            <textarea
              value={form.lesson}
              onChange={(event) => updateField("lesson", event.target.value)}
              rows={3}
            />
          </label>
        </div>
        <div className="form-actions">
          {message && <span className="form-message">{message}</span>}
          <button className="button button--primary" disabled={busy}>
            {editingId ? <Save size={16} /> : <Plus size={16} />}
            {editingId ? "Save changes" : "Add trade entry"}
          </button>
        </div>
      </form>

      <div className="journal-analytics">
        <article>
          <span>Followed the system</span>
          <strong>{followed.length} trades</strong>
          <p className={followedPL >= 0 ? "text-up" : "text-down"}>
            {formatMoney(followedPL)} total P/L
          </p>
        </article>
        <article>
          <span>Overrode the system</span>
          <strong>{overridden.length} trades</strong>
          <p className={overriddenPL >= 0 ? "text-up" : "text-down"}>
            {formatMoney(overriddenPL)} total P/L
          </p>
        </article>
        <article>
          <span>Decision impact</span>
          <strong>{formatMoney(followedPL - overriddenPL)}</strong>
          <p>System-following P/L minus override P/L</p>
        </article>
      </div>

      <TradeTable
        id="actual-open-positions"
        title="Actual open positions"
        copy="Real positions with remaining quantity, kept separate from model alerts."
        items={open}
        onEdit={beginEdit}
        onDelete={deleteTrade}
        onExit={beginExit}
        onDeleteExit={deleteExit}
      />
      <TradeTable
        id="actual-closed-trades"
        title="Actual closed trades"
        copy="Fully exited real trades with realised return and holding period."
        items={closed}
        onEdit={beginEdit}
        onDelete={deleteTrade}
        onExit={beginExit}
        onDeleteExit={deleteExit}
      />

      {exitTrade && (
        <div className="modal-scrim" role="presentation">
          <form className="exit-modal" onSubmit={submitExit} aria-label="Record trade exit">
            <div className="form-heading">
              <div>
                <span>Partial or full exit</span>
                <h3>Record exit for {exitTrade.ticker}</h3>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setExitTrade(null)}
                aria-label="Close exit form"
              >
                <X size={17} />
              </button>
            </div>
            <div className="form-grid form-grid--compact">
              <label className="field">
                <span>Exit date</span>
                <input
                  type="date"
                  required
                  value={exitForm.exitDate}
                  onChange={(event) =>
                    setExitForm({ ...exitForm, exitDate: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Exit price (£)</span>
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  required
                  value={exitForm.exitPrice}
                  onChange={(event) =>
                    setExitForm({ ...exitForm, exitPrice: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Quantity sold</span>
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  required
                  value={exitForm.quantitySold}
                  onChange={(event) =>
                    setExitForm({ ...exitForm, quantitySold: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Exit fees (£)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={exitForm.fees}
                  onChange={(event) =>
                    setExitForm({ ...exitForm, fees: event.target.value })
                  }
                />
              </label>
              <label className="field field--full">
                <span>Reason for exit</span>
                <input
                  required
                  value={exitForm.reason}
                  onChange={(event) =>
                    setExitForm({ ...exitForm, reason: event.target.value })
                  }
                />
              </label>
              <label className="field field--full">
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={exitForm.notes}
                  onChange={(event) =>
                    setExitForm({ ...exitForm, notes: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setExitTrade(null)}
              >
                Cancel
              </button>
              <button className="button button--primary" disabled={busy}>
                <Save size={16} /> Save exit
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function TradeTable({
  id,
  title,
  copy,
  items,
  onEdit,
  onDelete,
  onExit,
  onDeleteExit,
}: {
  id: string;
  title: string;
  copy: string;
  items: Array<{ trade: ManualTrade; result: ReturnType<typeof calculateTrade> }>;
  onEdit: (trade: ManualTrade) => void;
  onDelete: (trade: ManualTrade) => void;
  onExit: (trade: ManualTrade) => void;
  onDeleteExit: (tradeId: string, exitId: string) => void;
}) {
  return (
    <section className="panel manual-table-panel" id={id}>
      <div className="panel-title-row">
        <div>
          <span>Actual performance</span>
          <h3>{title}</h3>
          <p>{copy}</p>
        </div>
        <Badge tone="blue">{items.length} trades</Badge>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">No trades in this category yet.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table manual-trade-table">
            <thead>
              <tr>
                <th>Trade</th>
                <th>Capital / quantity</th>
                <th>Realised</th>
                <th>Unrealised</th>
                <th>Total return</th>
                <th>Holding period</th>
                <th>Exits</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ trade, result }) => (
                <tr key={trade.id}>
                  <td data-label="Trade">
                    <strong className="table-primary">{trade.assetName}</strong>
                    <span className="table-secondary">
                      Actual manually entered trade ·{" "}
                      {trade.sleeve ?? "Discretionary / untagged"}
                    </span>
                    <span className="table-secondary">
                      {trade.ticker} · {trade.strategyName}
                    </span>
                    <span className="table-secondary">
                      Entered {formatDate(trade.entryDate)} at £
                      {formatNumber(trade.entryPrice)}
                    </span>
                  </td>
                  <td data-label="Capital">
                    <strong className="table-primary">
                      {formatMoney(trade.amountInvested)}
                    </strong>
                    <span className="table-secondary">
                      {formatNumber(result.quantityRemaining, 4)} /{" "}
                      {formatNumber(trade.quantity, 4)} remaining
                    </span>
                    <span className="table-secondary">
                      Open value {formatMoney(result.openPositionValue)}
                    </span>
                  </td>
                  <td data-label="Realised">
                    <PLValue
                      money={result.realisedPL}
                      percent={result.realisedPLPercent}
                    />
                  </td>
                  <td data-label="Unrealised">
                    <PLValue
                      money={result.unrealisedPL}
                      percent={result.unrealisedPLPercent}
                    />
                  </td>
                  <td data-label="Total return">
                    <PLValue
                      money={result.totalPL}
                      percent={result.totalReturnPercent}
                    />
                  </td>
                  <td data-label="Holding">
                    <strong className="table-primary">{result.holdingDays} days</strong>
                    <span className="table-secondary">{result.status}</span>
                  </td>
                  <td data-label="Exits">
                    {trade.exits.length === 0 ? (
                      <span className="table-secondary">None recorded</span>
                    ) : (
                      <div className="exit-list">
                        {trade.exits.map((exit) => (
                          <span key={exit.id}>
                            {formatDate(exit.exitDate)} · {exit.quantitySold} @ £
                            {formatNumber(exit.exitPrice)}
                            <button
                              onClick={() => onDeleteExit(trade.id, exit.id)}
                              aria-label={`Delete exit from ${exit.exitDate}`}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td data-label="Actions">
                    <div className="row-actions">
                      {result.quantityRemaining > 0 && (
                        <button onClick={() => onExit(trade)} title="Record exit">
                          <Plus size={15} /> Exit
                        </button>
                      )}
                      <button onClick={() => onEdit(trade)} title="Edit trade">
                        <Pencil size={15} /> Edit
                      </button>
                      <button
                        className="danger-action"
                        onClick={() => onDelete(trade)}
                        title="Delete trade"
                      >
                        <Trash2 size={15} /> Delete
                      </button>
                      {trade.referenceLink && (
                        <a
                          href={trade.referenceLink}
                          target="_blank"
                          rel="noreferrer"
                          title="Open reference link"
                        >
                          <ExternalLink size={15} /> Link
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PLValue({ money, percent }: { money: number; percent: number }) {
  return (
    <div className={money >= 0 ? "pl-stack pl-stack--up" : "pl-stack pl-stack--down"}>
      <strong>
        {money >= 0 ? "+" : ""}
        {formatMoney(money)}
      </strong>
      <span>
        {percent >= 0 ? "+" : ""}
        {formatNumber(percent)}%
      </span>
    </div>
  );
}