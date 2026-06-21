import { Plus, Save, X } from "lucide-react";
import { useMemo, useState, type FormEvent, type InputHTMLAttributes } from "react";
import type { ManualTrade, MultiStrategyPublicState } from "../types";
import { formatDateTime, formatMoney, formatNumber } from "../utils/format";
import {
  STRATEGY_OPTIONS,
  applySignalActionOption,
  buildClosedTradeRows,
  buildManualExitPayload,
  buildManualTradePayload,
  buildOpenTradeRows,
  buildSignalActionOptions,
  emptySimpleTradeForm,
  toDateTimeLocal,
  type ClosedTradeRow,
  type OpenTradeRow,
  type SimpleTradeFormState,
} from "../utils/tradeJournalSignalActions";
import { Badge } from "./ui";

interface CloseTradeState {
  exitDate: string;
  exitPrice: string;
  quantitySold: string;
  fees: string;
  notes: string;
}

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
  const [form, setForm] = useState<SimpleTradeFormState>(() =>
    emptySimpleTradeForm(),
  );
  const [totalCostOverridden, setTotalCostOverridden] = useState(false);
  const [closingTrade, setClosingTrade] = useState<OpenTradeRow | null>(null);
  const [closeForm, setCloseForm] = useState<CloseTradeState>(() =>
    emptyCloseForm(null),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const openRows = useMemo(() => buildOpenTradeRows(trades), [trades]);
  const closedRows = useMemo(() => buildClosedTradeRows(trades), [trades]);
  const signalOptions = useMemo(
    () => buildSignalActionOptions(strategyMonitor),
    [strategyMonitor],
  );

  function updateField(name: keyof SimpleTradeFormState, value: string) {
    setForm((current) => {
      const next = { ...current, [name]: value };
      if ((name === "quantity" || name === "price") && !totalCostOverridden) {
        next.totalCost = calculatedTotalCost(next.quantity, next.price);
      }
      return next;
    });
  }

  function updateTotalCost(value: string) {
    setTotalCostOverridden(true);
    updateField("totalCost", value);
  }

  function applyPrefill(optionId: string) {
    const option = signalOptions.find((item) => item.optionId === optionId);
    if (!option) return;
    setForm((current) => applySignalActionOption(current, option));
  }

  function resetForm() {
    setForm(emptySimpleTradeForm());
    setTotalCostOverridden(false);
  }

  async function submitTrade(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (form.action === "close") {
        const match = findOpenTrade(openRows, form.ticker);
        if (!match) {
          setMessage("No matching open trade was found for that ticker.");
          return;
        }
        await mutate(
          `/manual-trades/${match.trade.id}/exits`,
          "POST",
          buildManualExitPayload(form, match.quantityRemaining),
        );
        setMessage("Trade closed.");
        resetForm();
        return;
      }

      await mutate("/manual-trades", "POST", buildManualTradePayload(form));
      setMessage("Trade recorded.");
      resetForm();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Trade could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  function beginCloseTrade(row: OpenTradeRow) {
    setClosingTrade(row);
    setCloseForm(emptyCloseForm(row));
  }

  async function submitCloseTrade(event: FormEvent) {
    event.preventDefault();
    if (!closingTrade) return;
    setBusy(true);
    setMessage("");
    try {
      await mutate(`/manual-trades/${closingTrade.trade.id}/exits`, "POST", {
        exitDate: closeForm.exitDate,
        exitPrice: Number(closeForm.exitPrice),
        quantitySold: Number(closeForm.quantitySold),
        fees: Number(closeForm.fees || 0),
        reason: "Close trade",
        notes: closeForm.notes,
      });
      setMessage("Trade closed.");
      setClosingTrade(null);
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Trade could not be closed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="manual-trades-stack">
      {isExample && (
        <div className="example-banner">
          <Badge tone="amber">FAKE SAMPLE DATA</Badge>
          These records demonstrate the interface only. Adding your first manual
          trade replaces example mode.
        </div>
      )}

      <form
        className="entry-form panel simple-trade-form"
        id="trade-entry"
        onSubmit={submitTrade}
      >
        <div className="form-heading">
          <div>
            <span>Open trade · Close trade</span>
            <h3>Record trade</h3>
            <p>
              This only records what you did manually. It does not place a broker
              order.
            </p>
          </div>
        </div>

        <div className="signal-action-helper">
          <label className="field">
            <span>Prefill from signal</span>
            <select
              aria-label="Prefill from signal"
              value=""
              onChange={(event) => applyPrefill(event.target.value)}
            >
              <option value="">Choose an open model position or recent signal</option>
              {signalOptions.map((option) => (
                <option key={option.optionId} value={option.optionId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p>
            Prefill only sets strategy, ticker, action and notes. Enter quantity,
            price, total cost and date yourself.
          </p>
        </div>

        <div className="form-grid simple-trade-grid">
          <SelectField
            label="Strategy"
            value={form.strategySource}
            onChange={(value) =>
              updateField(
                "strategySource",
                value as SimpleTradeFormState["strategySource"],
              )
            }
            options={STRATEGY_OPTIONS.map((option) => [option, option])}
          />
          <InputField
            label="Ticker"
            value={form.ticker}
            onChange={(value) => updateField("ticker", value)}
            placeholder="QQQ3.L"
            required
          />
          <SelectField
            label="Action"
            value={form.action}
            onChange={(value) =>
              updateField("action", value as SimpleTradeFormState["action"])
            }
            options={[
              ["open", "Buy / Open long"],
              ["close", "Sell / Close long"],
            ]}
          />
          <InputField
            label="Trade date"
            type="datetime-local"
            value={form.tradeDate}
            onChange={(value) => updateField("tradeDate", value)}
            required
          />
          <InputField
            label="Quantity"
            type="number"
            value={form.quantity}
            onChange={(value) => updateField("quantity", value)}
            min="0.000001"
            step="any"
            placeholder="10"
            required
          />
          <InputField
            label="Price"
            type="number"
            value={form.price}
            onChange={(value) => updateField("price", value)}
            min="0.000001"
            step="any"
            placeholder="479.00"
            required
          />
          <InputField
            label="Total cost"
            type="number"
            value={form.totalCost}
            onChange={updateTotalCost}
            min="0.01"
            step="0.01"
            placeholder="Auto: quantity × price"
            required
          />
          <InputField
            label="Fees"
            type="number"
            value={form.fees}
            onChange={(value) => updateField("fees", value)}
            min="0"
            step="0.01"
            placeholder="Optional"
          />
          <label className="field field--full">
            <span>Notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              rows={3}
              placeholder="Optional"
            />
          </label>
        </div>

        <div className="form-actions">
          {message && <span className="form-message">{message}</span>}
          <button className="button button--primary" disabled={busy}>
            <Plus size={16} /> Record trade
          </button>
        </div>
      </form>

      <OpenTradesTable rows={openRows} onClose={beginCloseTrade} />
      <ClosedTradesTable rows={closedRows} />

      {closingTrade && (
        <div className="modal-scrim" role="presentation">
          <form
            className="exit-modal"
            onSubmit={submitCloseTrade}
            aria-label="Close trade"
          >
            <div className="form-heading">
              <div>
                <span>Close trade</span>
                <h3>Close {closingTrade.ticker}</h3>
                <p>
                  This only records what you did manually. It does not place a
                  broker order.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setClosingTrade(null)}
                aria-label="Close form"
              >
                <X size={17} />
              </button>
            </div>
            <div className="form-grid form-grid--compact">
              <CloseInput
                label="Exit date"
                type="datetime-local"
                value={closeForm.exitDate}
                onChange={(value) =>
                  setCloseForm((current) => ({ ...current, exitDate: value }))
                }
              />
              <CloseInput
                label="Exit price"
                type="number"
                value={closeForm.exitPrice}
                onChange={(value) =>
                  setCloseForm((current) => ({ ...current, exitPrice: value }))
                }
              />
              <CloseInput
                label="Quantity to close"
                type="number"
                value={closeForm.quantitySold}
                onChange={(value) =>
                  setCloseForm((current) => ({ ...current, quantitySold: value }))
                }
              />
              <InputField
                label="Exit fees"
                type="number"
                value={closeForm.fees}
                onChange={(value) =>
                  setCloseForm((current) => ({ ...current, fees: value }))
                }
                min="0"
                step="0.01"
                placeholder="Optional"
              />
              <label className="field field--full">
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={closeForm.notes}
                  onChange={(event) =>
                    setCloseForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setClosingTrade(null)}
              >
                Cancel
              </button>
              <button className="button button--primary" disabled={busy}>
                <Save size={16} /> Close trade
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function OpenTradesTable({
  rows,
  onClose,
}: {
  rows: OpenTradeRow[];
  onClose: (row: OpenTradeRow) => void;
}) {
  return (
    <section className="panel manual-table-panel" id="open-trades">
      <div className="panel-title-row">
        <div>
          <span>Open trade</span>
          <h3>Open trades</h3>
        </div>
        <Badge tone="blue">{rows.length} open</Badge>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">No open manual trades yet.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table manual-trade-table simple-trade-table">
            <thead>
              <tr>
                <th>Date opened</th>
                <th>Strategy</th>
                <th>Ticker</th>
                <th>Quantity</th>
                <th>Entry price</th>
                <th>Total cost</th>
                <th>Fees</th>
                <th>Notes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.trade.id}>
                  <td data-label="Date opened">{safeDate(row.dateOpened)}</td>
                  <td data-label="Strategy">{row.strategySource}</td>
                  <td data-label="Ticker">
                    <strong className="table-primary">{row.ticker}</strong>
                  </td>
                  <td data-label="Quantity">
                    {formatNumber(row.quantityRemaining, 4)}
                  </td>
                  <td data-label="Entry price">{formatMoney(row.entryPrice, 2)}</td>
                  <td data-label="Total cost">{formatMoney(row.totalCost, 2)}</td>
                  <td data-label="Fees">{formatMoney(row.fees, 2)}</td>
                  <td data-label="Notes">
                    <span className="table-secondary">{row.notes || "—"}</span>
                  </td>
                  <td data-label="Action">
                    <button onClick={() => onClose(row)}>Close trade</button>
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

function ClosedTradesTable({ rows }: { rows: ClosedTradeRow[] }) {
  return (
    <section className="panel manual-table-panel" id="closed-trades">
      <div className="panel-title-row">
        <div>
          <span>Close trade</span>
          <h3>Closed trades</h3>
        </div>
        <Badge tone="blue">{rows.length} closed</Badge>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">No closed manual trades yet.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table manual-trade-table simple-trade-table">
            <thead>
              <tr>
                <th>Date opened</th>
                <th>Date closed</th>
                <th>Strategy</th>
                <th>Ticker</th>
                <th>Quantity</th>
                <th>Entry price</th>
                <th>Exit price</th>
                <th>Total cost</th>
                <th>Total P/L</th>
                <th>P/L %</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.trade.id}>
                  <td data-label="Date opened">{safeDate(row.dateOpened)}</td>
                  <td data-label="Date closed">{safeDate(row.dateClosed)}</td>
                  <td data-label="Strategy">{row.strategySource}</td>
                  <td data-label="Ticker">
                    <strong className="table-primary">{row.ticker}</strong>
                  </td>
                  <td data-label="Quantity">{formatNumber(row.quantity, 4)}</td>
                  <td data-label="Entry price">{formatMoney(row.entryPrice, 2)}</td>
                  <td data-label="Exit price">{formatMoney(row.exitPrice, 2)}</td>
                  <td data-label="Total cost">{formatMoney(row.totalCost, 2)}</td>
                  <td data-label="Total P/L">
                    <PLValue money={row.totalPnl} />
                  </td>
                  <td data-label="P/L %">{formatNumber(row.pnlPercent, 2)}%</td>
                  <td data-label="Notes">
                    <span className="table-secondary">{row.notes || "—"}</span>
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

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>
            {text}
          </option>
        ))}
      </select>
    </label>
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
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
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

function CloseInput({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <InputField
      label={label}
      value={value}
      onChange={onChange}
      min="0.000001"
      step="any"
      required
      {...props}
    />
  );
}

function PLValue({ money }: { money: number }) {
  return (
    <span className={money >= 0 ? "pl-stack pl-stack--up" : "pl-stack pl-stack--down"}>
      <strong>
        {money >= 0 ? "+" : ""}
        {formatMoney(money, 2)}
      </strong>
    </span>
  );
}

function findOpenTrade(rows: OpenTradeRow[], ticker: string) {
  const target = ticker.trim().toUpperCase();
  return rows.find((row) => row.ticker.trim().toUpperCase() === target);
}

function calculatedTotalCost(quantity: string, price: string) {
  const numericQuantity = Number(quantity);
  const numericPrice = Number(price);
  if (
    !Number.isFinite(numericQuantity) ||
    !Number.isFinite(numericPrice) ||
    numericQuantity <= 0 ||
    numericPrice <= 0
  ) {
    return "";
  }
  return (numericQuantity * numericPrice).toFixed(2);
}

function safeDate(value: string) {
  try {
    return formatDateTime(value);
  } catch {
    return value;
  }
}

function emptyCloseForm(row: OpenTradeRow | null): CloseTradeState {
  const fallbackPrice = row?.trade.currentPrice || row?.entryPrice || "";
  return {
    exitDate: toDateTimeLocal(new Date().toISOString()),
    exitPrice: fallbackPrice ? String(fallbackPrice) : "",
    quantitySold: row ? String(row.quantityRemaining) : "",
    fees: "0",
    notes: "",
  };
}
