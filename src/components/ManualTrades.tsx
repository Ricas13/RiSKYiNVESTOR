import { ExternalLink, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { ManualTrade, MultiStrategyPublicState } from "../types";
import { formatDateTime, formatMoney, formatNumber } from "../utils/format";
import { calculateTrade } from "../utils/manualTrades";
import {
  applySignalActionOption,
  buildJournalActionRows,
  buildManualExitPayload,
  buildManualTradePayload,
  buildSignalActionOptions,
  emptySignalActionForm,
  sourceForManualTrade,
  toDateTimeLocal,
  type JournalActionRow,
  type SignalActionFormState,
} from "../utils/tradeJournalSignalActions";
import { Badge } from "./ui";

export function ManualTrades({
  trades,
  strategyMonitor,
  isExample,
  mutate,
}: {
  trades: ManualTrade[];
  strategyMonitor: MultiStrategyPublicState;
  isExample: boolean;
  mutate: (
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body?: unknown,
  ) => Promise<unknown>;
}) {
  const [form, setForm] = useState<SignalActionFormState>(() =>
    emptySignalActionForm(),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exitTrade, setExitTrade] = useState<ManualTrade | null>(null);
  const [exitForm, setExitForm] = useState(() => emptyExitForm(null));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const calculated = useMemo(
    () => trades.map((trade) => ({ trade, result: calculateTrade(trade) })),
    [trades],
  );
  const openTrades = calculated.filter(
    (item) => item.result.quantityRemaining > 0,
  );
  const rows = useMemo(() => buildJournalActionRows(trades), [trades]);
  const options = useMemo(
    () => buildSignalActionOptions(strategyMonitor),
    [strategyMonitor],
  );
  const derivedQuantity = quantityPreview(form);

  function updateField(name: keyof SignalActionFormState, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function applyPrefill(optionId: string) {
    const option = options.find((item) => item.optionId === optionId);
    if (!option) return;
    setForm((current) => applySignalActionOption(current, option));
  }

  function resetForm() {
    setForm(emptySignalActionForm());
    setEditingId(null);
  }

  function beginEdit(trade: ManualTrade) {
    setEditingId(trade.id);
    setForm({
      strategySource: sourceForManualTrade(trade),
      signalTicker: trade.assetName,
      executionTicker: trade.ticker,
      action: "enter",
      actionAt: toDateTimeLocal(trade.entryDate),
      price: String(trade.entryPrice),
      quantity: String(trade.quantity),
      amountInvested: String(trade.amountInvested),
      fees: String(trade.fees),
      notes: trade.notes,
      referenceLink: trade.referenceLink,
      riskTier: trade.riskTier ?? "CORE",
      assetClass: trade.assetClass ?? "Signal action",
      isTechnology: String(trade.isTechnology ?? false),
      isSingleStock: String(trade.isSingleStock ?? false),
      leverageMultiplier: String(trade.leverageMultiplier ?? 1),
      entryReason: trade.journal?.entryReason ?? "",
      followedSystem: String(trade.journal?.followedSystem ?? true),
      overrodeSystem: String(trade.journal?.overrodeSystem ?? false),
      emotionalState: trade.journal?.emotionalState ?? "",
      checkedChart: String(trade.journal?.checkedChart ?? true),
      lesson: trade.journal?.lesson ?? "",
      source: trade.source,
    });
    document
      .querySelector("#trade-entry")
      ?.scrollIntoView({ behavior: "smooth" });
  }

  async function submitTrade(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (form.action === "exit" && !editingId) {
        const match = findOpenTrade(openTrades, form.executionTicker);
        if (!match) {
          setMessage(
            "No matching open manual trade was found for that execution ticker. Record an entry first, or use the row-level Exit action.",
          );
          return;
        }
        await mutate(
          `/manual-trades/${match.trade.id}/exits`,
          "POST",
          buildManualExitPayload(form, match.result.quantityRemaining),
        );
        setMessage("Signal exit recorded.");
        resetForm();
        return;
      }

      await mutate(
        editingId ? `/manual-trades/${editingId}` : "/manual-trades",
        editingId ? "PUT" : "POST",
        buildManualTradePayload(form),
      );
      setMessage(editingId ? "Signal action updated." : "Signal action recorded.");
      resetForm();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Signal action could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteTrade(trade: ManualTrade) {
    if (!window.confirm(`Delete ${trade.ticker} and all recorded exits?`)) return;
    await mutate(`/manual-trades/${trade.id}`, "DELETE");
  }

  function beginExit(trade: ManualTrade) {
    setExitTrade(trade);
    setExitForm(emptyExitForm(trade));
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
      setMessage("Signal exit recorded.");
      setExitTrade(null);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Exit could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteExit(tradeId: string, exitId: string) {
    if (!window.confirm("Delete this exit record?")) return;
    await mutate(`/manual-trades/${tradeId}/exits/${exitId}`, "DELETE");
  }

  return (
    <div className="manual-trades-stack">
      {isExample && (
        <div className="example-banner">
          <Badge tone="amber">FAKE SAMPLE DATA</Badge>
          These records demonstrate the interface only. Adding your first signal
          action replaces example mode.
        </div>
      )}

      <form
        className="entry-form panel signal-action-form"
        id="trade-entry"
        onSubmit={submitTrade}
      >
        <div className="form-heading">
          <div>
            <span>{editingId ? "Edit signal action" : "Record signal action"}</span>
            <h3>{editingId ? "Update manual action" : "I acted on this signal"}</h3>
            <p>
              Use this to track what you personally acted on. This does not place
              a broker trade.
            </p>
          </div>
          {editingId && (
            <button type="button" className="icon-button" onClick={resetForm}>
              <X size={17} />
              <span className="sr-only">Cancel edit</span>
            </button>
          )}
        </div>

        <div className="signal-action-helper">
          <label className="field">
            <span>Prefill from scanner data</span>
            <select
              aria-label="Prefill from scanner data"
              value=""
              onChange={(event) => applyPrefill(event.target.value)}
            >
              <option value="">
                Choose open model position, recent event, or ticker pair
              </option>
              {options.map((option) => (
                <option key={option.optionId} value={option.optionId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p>
            Scanner suggestions only prefill the form. You can still edit every
            field before saving.
          </p>
        </div>

        <div className="form-grid">
          <SelectField
            label="Strategy source"
            value={form.strategySource}
            onChange={(value) =>
              updateField(
                "strategySource",
                value as SignalActionFormState["strategySource"],
              )
            }
            options={["Daily SuperTrend", "Nasdaq SMA200", "Manual / Discretionary"]}
          />
          <SelectField
            label="Action"
            value={form.action}
            onChange={(value) =>
              updateField("action", value as SignalActionFormState["action"])
            }
            disabled={Boolean(editingId)}
            options={[
              ["enter", "Buy / Enter"],
              ["exit", "Sell / Exit"],
            ]}
          />
          <InputField
            label="Signal ticker"
            value={form.signalTicker}
            onChange={(value) => updateField("signalTicker", value)}
            placeholder="QQQ"
            required
          />
          <InputField
            label="Execution ticker"
            value={form.executionTicker}
            onChange={(value) => updateField("executionTicker", value)}
            placeholder="QQQ3.L"
            required
          />
          <InputField
            label="Date/time"
            type="datetime-local"
            value={form.actionAt}
            onChange={(value) => updateField("actionAt", value)}
            required
          />
          <InputField
            label="Price (£)"
            type="number"
            value={form.price}
            onChange={(value) => updateField("price", value)}
            min="0.000001"
            step="any"
            required
          />
          <InputField
            label="Amount invested (£)"
            type="number"
            value={form.amountInvested}
            onChange={(value) => updateField("amountInvested", value)}
            min="0.01"
            step="0.01"
            required
          />
          <InputField
            label="Quantity optional"
            type="number"
            value={form.quantity}
            onChange={(value) => updateField("quantity", value)}
            min="0.000001"
            step="any"
            placeholder={
              derivedQuantity ? `≈ ${derivedQuantity}` : "Auto from amount ÷ price"
            }
          />
          <InputField
            label="Fees optional (£)"
            type="number"
            value={form.fees}
            onChange={(value) => updateField("fees", value)}
            min="0"
            step="0.01"
          />
          <label className="field field--full">
            <span>Notes optional</span>
            <textarea
              value={form.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              rows={3}
              placeholder="What signal did you act on, and why?"
            />
          </label>

          <details className="advanced-details field--full">
            <summary>Advanced details</summary>
            <div className="form-grid form-grid--advanced">
              <SelectField
                label="Risk tier"
                value={form.riskTier}
                onChange={(value) => updateField("riskTier", value)}
                options={["CORE", "AGGRESSIVE", "SPECULATIVE", "EXCLUDED"]}
              />
              <InputField
                label="Asset class"
                value={form.assetClass}
                onChange={(value) => updateField("assetClass", value)}
              />
              <BooleanField
                label="Technology exposure?"
                value={form.isTechnology}
                onChange={(value) => updateField("isTechnology", value)}
              />
              <BooleanField
                label="Single-stock exposure?"
                value={form.isSingleStock}
                onChange={(value) => updateField("isSingleStock", value)}
              />
              <SelectField
                label="Leverage multiplier"
                value={form.leverageMultiplier}
                onChange={(value) => updateField("leverageMultiplier", value)}
                options={[
                  ["1", "1× / unleveraged"],
                  ["2", "2×"],
                  ["3", "3×"],
                ]}
              />
              <SelectField
                label="Record source"
                value={form.source}
                onChange={(value) => updateField("source", value)}
                options={[
                  ["manual", "Manual"],
                  ["Discord alert", "Discord alert"],
                  ["imported", "Imported"],
                ]}
              />
              <InputField
                label="Optional screenshot / link"
                type="url"
                value={form.referenceLink}
                onChange={(value) => updateField("referenceLink", value)}
                placeholder="https://…"
              />
              <label className="field field--wide">
                <span>Signal reason</span>
                <textarea
                  value={form.entryReason}
                  onChange={(event) => updateField("entryReason", event.target.value)}
                  rows={3}
                />
              </label>
              <BooleanField
                label="Followed the system?"
                value={form.followedSystem}
                onChange={(value) => updateField("followedSystem", value)}
              />
              <BooleanField
                label="Overrode the system?"
                value={form.overrodeSystem}
                onChange={(value) => updateField("overrodeSystem", value)}
              />
              <BooleanField
                label="Checked the chart first?"
                value={form.checkedChart}
                onChange={(value) => updateField("checkedChart", value)}
              />
              <InputField
                label="Emotion journal"
                value={form.emotionalState}
                onChange={(value) => updateField("emotionalState", value)}
                placeholder="Optional"
              />
              <label className="field field--wide">
                <span>Lesson / review note</span>
                <textarea
                  value={form.lesson}
                  onChange={(event) => updateField("lesson", event.target.value)}
                  rows={3}
                />
              </label>
            </div>
          </details>
        </div>

        <div className="form-actions">
          {message && <span className="form-message">{message}</span>}
          <button className="button button--primary" disabled={busy}>
            {editingId ? <Save size={16} /> : <Plus size={16} />}
            {editingId ? "Save signal action" : "Record signal action"}
          </button>
        </div>
      </form>

      <div className="journal-analytics signal-action-summary">
        <SummaryCard label="Manual action log" value={`${rows.length} actions`}>
          Entries and exits you personally recorded.
        </SummaryCard>
        <SummaryCard
          label="Buy / enter"
          value={`${rows.filter((row) => row.actionLabel === "Buy / Enter").length} actions`}
        >
          Signal actions that opened or added exposure.
        </SummaryCard>
        <SummaryCard
          label="Sell / exit"
          value={`${rows.filter((row) => row.actionLabel === "Sell / Exit").length} actions`}
        >
          Signal actions that reduced or closed exposure.
        </SummaryCard>
        <SummaryCard
          label="Total logged amount"
          value={formatMoney(rows.reduce((sum, row) => sum + row.amount, 0))}
        >
          Gross action amount across manual rows.
        </SummaryCard>
      </div>

      <ManualActionLogTable
        rows={rows}
        onEdit={beginEdit}
        onDelete={deleteTrade}
        onExit={beginExit}
        onDeleteExit={deleteExit}
      />

      {exitTrade && (
        <div className="modal-scrim" role="presentation">
          <form
            className="exit-modal"
            onSubmit={submitExit}
            aria-label="Record signal exit"
          >
            <div className="form-heading">
              <div>
                <span>Sell / exit action</span>
                <h3>Record exit for {exitTrade.ticker}</h3>
                <p>This logs what you did; it does not place a broker trade.</p>
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
              <ExitInput
                label="Date/time"
                type="datetime-local"
                value={exitForm.exitDate}
                onChange={(value) =>
                  setExitForm((current) => ({ ...current, exitDate: value }))
                }
              />
              <ExitInput
                label="Price (£)"
                type="number"
                value={exitForm.exitPrice}
                onChange={(value) =>
                  setExitForm((current) => ({ ...current, exitPrice: value }))
                }
              />
              <ExitInput
                label="Quantity"
                type="number"
                value={exitForm.quantitySold}
                onChange={(value) =>
                  setExitForm((current) => ({ ...current, quantitySold: value }))
                }
              />
              <ExitInput
                label="Fees optional (£)"
                type="number"
                value={exitForm.fees}
                onChange={(value) =>
                  setExitForm((current) => ({ ...current, fees: value }))
                }
              />
              <ExitInput
                label="Reason"
                value={exitForm.reason}
                onChange={(value) =>
                  setExitForm((current) => ({ ...current, reason: value }))
                }
              />
              <label className="field field--full">
                <span>Notes optional</span>
                <textarea
                  rows={3}
                  value={exitForm.notes}
                  onChange={(event) =>
                    setExitForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
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

function ManualActionLogTable({
  rows,
  onEdit,
  onDelete,
  onExit,
  onDeleteExit,
}: {
  rows: JournalActionRow[];
  onEdit: (trade: ManualTrade) => void;
  onDelete: (trade: ManualTrade) => void;
  onExit: (trade: ManualTrade) => void;
  onDeleteExit: (tradeId: string, exitId: string) => void;
}) {
  return (
    <section className="panel manual-table-panel" id="manual-action-log">
      <div className="panel-title-row">
        <div>
          <span>Manual action log</span>
          <h3>Signal actions you recorded</h3>
          <p>
            A clean journal of buys and sells taken from SuperTrend, SMA200, or
            discretionary signals.
          </p>
        </div>
        <Badge tone="blue">{rows.length} actions</Badge>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          No manual signal actions yet. Use Record signal action when you act on
          a signal.
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table manual-trade-table signal-action-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Strategy source</th>
                <th>Signal ticker</th>
                <th>Execution ticker</th>
                <th>Action</th>
                <th>Price</th>
                <th>Amount</th>
                <th>Quantity</th>
                <th>P/L</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.actionId}>
                  <td data-label="Date">
                    <strong className="table-primary">{safeDate(row.date)}</strong>
                  </td>
                  <td data-label="Strategy source">
                    <strong className="table-primary">{row.strategySource}</strong>
                  </td>
                  <td data-label="Signal ticker">
                    <strong className="table-primary">{row.signalTicker}</strong>
                  </td>
                  <td data-label="Execution ticker">
                    <strong className="table-primary">{row.executionTicker}</strong>
                  </td>
                  <td data-label="Action">
                    <Badge
                      tone={row.actionLabel === "Buy / Enter" ? "green" : "red"}
                    >
                      {row.actionLabel}
                    </Badge>
                  </td>
                  <td data-label="Price">{formatMoney(row.price, 2)}</td>
                  <td data-label="Amount">{formatMoney(row.amount, 2)}</td>
                  <td data-label="Quantity">{formatNumber(row.quantity, 4)}</td>
                  <td data-label="P/L">
                    {row.pnl === null ? (
                      <span className="table-secondary">—</span>
                    ) : (
                      <PLValue money={row.pnl} />
                    )}
                  </td>
                  <td data-label="Notes">
                    <span className="table-secondary">{row.notes || "—"}</span>
                    <AdvancedRowDetails trade={row.trade} />
                  </td>
                  <td data-label="Actions">
                    <div className="row-actions">
                      {row.canRecordExit && (
                        <button onClick={() => onExit(row.trade)} title="Record exit">
                          <Plus size={15} /> Exit
                        </button>
                      )}
                      {row.canEditTrade && (
                        <button onClick={() => onEdit(row.trade)} title="Edit trade">
                          <Pencil size={15} /> Edit
                        </button>
                      )}
                      {row.canEditTrade ? (
                        <button
                          className="danger-action"
                          onClick={() => onDelete(row.trade)}
                          title="Delete trade"
                        >
                          <Trash2 size={15} /> Delete
                        </button>
                      ) : (
                        row.exitId !== null && (
                          <button
                            className="danger-action"
                            onClick={() =>
                              onDeleteExit(row.trade.id, String(row.exitId))
                            }
                            title="Delete exit"
                          >
                            <Trash2 size={15} /> Delete exit
                          </button>
                        )
                      )}
                      {row.referenceLink && (
                        <a
                          href={row.referenceLink}
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

function AdvancedRowDetails({ trade }: { trade: ManualTrade }) {
  return (
    <details className="manual-action-row-details">
      <summary>Advanced details</summary>
      <dl>
        <Detail label="Risk tier" value={trade.riskTier} />
        <Detail label="Asset class" value={trade.assetClass} />
        <Detail
          label="Technology exposure"
          value={trade.isTechnology ? "Yes" : "No"}
        />
        <Detail
          label="Single-stock exposure"
          value={trade.isSingleStock ? "Yes" : "No"}
        />
        <Detail
          label="Leverage multiplier"
          value={`${trade.leverageMultiplier ?? "—"}×`}
        />
        <Detail
          label="Emotion journal"
          value={trade.journal?.emotionalState || "—"}
        />
      </dl>
    </details>
  );
}

function SummaryCard({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: string;
}) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{children}</p>
    </article>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: Array<string | [string, string]>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map((option) => {
          const [optionValue, text] = Array.isArray(option)
            ? option
            : [option, option];
          return (
            <option key={optionValue} value={optionValue}>
              {text}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function BooleanField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      options={[
        ["false", "No"],
        ["true", "Yes"],
      ]}
    />
  );
}

function InputField({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </label>
  );
}

function ExitInput({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return <InputField label={label} value={value} onChange={onChange} {...props} required />;
}

function Detail({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function PLValue({ money }: { money: number }) {
  return (
    <div className={money >= 0 ? "pl-stack pl-stack--up" : "pl-stack pl-stack--down"}>
      <strong>
        {money >= 0 ? "+" : ""}
        {formatMoney(money, 2)}
      </strong>
    </div>
  );
}

function findOpenTrade(
  items: Array<{
    trade: ManualTrade;
    result: ReturnType<typeof calculateTrade>;
  }>,
  executionTicker: string,
) {
  const target = executionTicker.trim().toUpperCase();
  return items.find((item) => item.trade.ticker.trim().toUpperCase() === target);
}

function quantityPreview(form: SignalActionFormState) {
  if (form.quantity) return "";
  const amount = Number(form.amountInvested);
  const price = Number(form.price);
  if (!Number.isFinite(amount) || !Number.isFinite(price) || amount <= 0 || price <= 0) {
    return "";
  }
  return formatNumber(amount / price, 4);
}

function safeDate(value: string) {
  try {
    return formatDateTime(value);
  } catch {
    return value;
  }
}

function emptyExitForm(trade: ManualTrade | null) {
  const result = trade ? calculateTrade(trade) : null;
  return {
    exitDate: toDateTimeLocal(new Date().toISOString()),
    exitPrice: trade ? String(trade.currentPrice) : "",
    quantitySold: result ? String(result.quantityRemaining) : "",
    fees: "0",
    reason: "Exit signal",
    notes: "",
  };
}
