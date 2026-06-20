import { Plus, Save, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { StrategyConfiguration as StrategyConfigurationValue } from "../types";
import { Badge } from "./ui";

type Mutate = (
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
) => Promise<unknown>;

export function StrategyConfiguration({
  configuration,
  canManage,
  mutate,
}: {
  configuration: StrategyConfigurationValue;
  canManage: boolean;
  mutate: Mutate;
}) {
  const [draft, setDraft] = useState(() => structuredClone(configuration));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(configuration);
  const superTrend = draft.strategies.dailySuperTrend;
  const sma = draft.strategies.nasdaqSma200;

  useEffect(() => {
    setDraft(structuredClone(configuration));
  }, [configuration]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function updateSuperTrend(
    values: Partial<StrategyConfigurationValue["strategies"]["dailySuperTrend"]>,
  ) {
    setDraft((current) => ({
      ...current,
      strategies: {
        ...current.strategies,
        dailySuperTrend: {
          ...current.strategies.dailySuperTrend,
          ...values,
        },
      },
    }));
  }

  function updateSma(
    values: Partial<StrategyConfigurationValue["strategies"]["nasdaqSma200"]>,
  ) {
    setDraft((current) => ({
      ...current,
      strategies: {
        ...current.strategies,
        nasdaqSma200: {
          ...current.strategies.nasdaqSma200,
          ...values,
        },
      },
    }));
  }

  function updateWatchlist(
    index: number,
    values: Partial<
      StrategyConfigurationValue["strategies"]["dailySuperTrend"]["watchlist"][number]
    >,
  ) {
    updateSuperTrend({
      watchlist: superTrend.watchlist.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...values } : row,
      ),
    });
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await mutate("/strategy-configuration", "PUT", draft);
      setMessage("Strategy configuration saved atomically.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Configuration could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card strategy-configuration">
      <div className="settings-card__heading">
        <Settings2 size={20} />
        <div>
          <h2>Strategy Configuration</h2>
          <p>
            Configure the two independent virtual strategies. Both remain
            disabled until their inputs are valid and they are explicitly enabled.
          </p>
        </div>
        <Badge
          tone={superTrend.enabled || sma.enabled ? "green" : "blue"}
        >
          {superTrend.enabled || sma.enabled ? "SCANNING ENABLED" : "DISABLED"}
        </Badge>
      </div>

      {!canManage && (
        <p className="settings-note">
          Owner or admin access is required to change scanner configuration.
        </p>
      )}

      <fieldset disabled={!canManage || busy}>
        <div className="strategy-config__header">
          <div>
            <h3>Daily SuperTrend</h3>
            <p>Multi-ticker virtual strategy book.</p>
          </div>
          <label className="toggle-row">
            <span>Enable strategy</span>
            <input
              type="checkbox"
              checked={superTrend.enabled}
              onChange={(event) =>
                updateSuperTrend({ enabled: event.target.checked })
              }
            />
            <i aria-hidden="true" />
          </label>
        </div>

        <div className="settings-field-grid strategy-config__fields">
          <TextField
            label="Timeframe"
            value={superTrend.timeframe}
            onChange={(timeframe) => updateSuperTrend({ timeframe })}
          />
          <NumberField
            label="ATR period"
            value={superTrend.atrPeriod}
            min={2}
            onChange={(atrPeriod) => updateSuperTrend({ atrPeriod })}
          />
          <NumberField
            label="Multiplier"
            value={superTrend.multiplier}
            min={0.1}
            step={0.1}
            onChange={(multiplier) => updateSuperTrend({ multiplier })}
          />
          <NumberField
            label="Model starting capital"
            value={superTrend.modelStartingCapital}
            min={1}
            onChange={(modelStartingCapital) =>
              updateSuperTrend({ modelStartingCapital })
            }
          />
          <label className="field">
            <span>Allocation policy</span>
            <select
              value={superTrend.allocationPolicy}
              onChange={(event) =>
                updateSuperTrend({
                  allocationPolicy: event.target.value as
                    | "equal_weight"
                    | "weighted",
                })
              }
            >
              <option value="equal_weight">Equal weight</option>
              <option value="weighted">Configured weights</option>
            </select>
          </label>
          <NumberField
            label="Maximum concurrent positions"
            value={superTrend.maximumConcurrentPositions}
            min={1}
            onChange={(maximumConcurrentPositions) =>
              updateSuperTrend({ maximumConcurrentPositions })
            }
          />
          <NumberField
            label="Transaction cost (%)"
            value={superTrend.transactionCostPercent}
            min={0}
            step={0.01}
            onChange={(transactionCostPercent) =>
              updateSuperTrend({ transactionCostPercent })
            }
          />
        </div>

        <div className="strategy-config__watchlist-heading">
          <div>
            <h4>SuperTrend watchlist mappings</h4>
            <p>
              No ticker mapping is assumed. Add the signal and UK execution
              tickers you have verified.
            </p>
          </div>
          <button
            type="button"
            className="button button--secondary"
            onClick={() =>
              updateSuperTrend({
                watchlist: [
                  ...superTrend.watchlist,
                  {
                    signalTicker: "",
                    executionTicker: "",
                    enabled: false,
                    allocationWeight: 1,
                  },
                ],
              })
            }
          >
            <Plus size={15} /> Add mapping
          </button>
        </div>

        <div className="table-scroll">
          <table className="data-table strategy-config__watchlist">
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Signal ticker</th>
                <th>UK execution ticker</th>
                <th>Weight</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {superTrend.watchlist.length === 0 && (
                <tr>
                  <td colSpan={5}>No watchlist mapping configured.</td>
                </tr>
              )}
              {superTrend.watchlist.map((row, index) => (
                <tr key={`${index}-${row.signalTicker}-${row.executionTicker}`}>
                  <td>
                    <input
                      aria-label={`Enable watchlist row ${index + 1}`}
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(event) =>
                        updateWatchlist(index, { enabled: event.target.checked })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Signal ticker ${index + 1}`}
                      value={row.signalTicker}
                      onChange={(event) =>
                        updateWatchlist(index, {
                          signalTicker: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Execution ticker ${index + 1}`}
                      value={row.executionTicker}
                      onChange={(event) =>
                        updateWatchlist(index, {
                          executionTicker: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Allocation weight ${index + 1}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={row.allocationWeight}
                      onChange={(event) =>
                        updateWatchlist(index, {
                          allocationWeight: Number(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove watchlist row ${index + 1}`}
                      onClick={() =>
                        updateSuperTrend({
                          watchlist: superTrend.watchlist.filter(
                            (_, rowIndex) => rowIndex !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="strategy-config__header">
          <div>
            <h3>Nasdaq SMA200 Regime — 3x</h3>
            <p>Independent risk-on/risk-off virtual portfolio.</p>
          </div>
          <label className="toggle-row">
            <span>Enable strategy</span>
            <input
              type="checkbox"
              checked={sma.enabled}
              onChange={(event) => updateSma({ enabled: event.target.checked })}
            />
            <i aria-hidden="true" />
          </label>
        </div>

        <div className="settings-field-grid strategy-config__fields">
          <TextField
            label="Reference ticker"
            value={sma.referenceTicker}
            onChange={(referenceTicker) =>
              updateSma({ referenceTicker: referenceTicker.toUpperCase() })
            }
          />
          <TextField
            label="UK risk-on 3x ticker"
            value={sma.riskOnTicker}
            onChange={(riskOnTicker) =>
              updateSma({ riskOnTicker: riskOnTicker.toUpperCase() })
            }
          />
          <label className="field">
            <span>Risk-off mode</span>
            <select
              value={sma.riskOffMode}
              onChange={(event) =>
                updateSma({
                  riskOffMode: event.target.value as "cash" | "instrument",
                })
              }
            >
              <option value="cash">Cash</option>
              <option value="instrument">Instrument</option>
            </select>
          </label>
          <TextField
            label="Risk-off ticker"
            value={sma.riskOffTicker}
            onChange={(riskOffTicker) =>
              updateSma({ riskOffTicker: riskOffTicker.toUpperCase() })
            }
          />
          <NumberField
            label="SMA length (SMA200)"
            value={sma.smaLength}
            min={2}
            onChange={(smaLength) => updateSma({ smaLength })}
          />
          <label className="field">
            <span>Review cadence</span>
            <select
              value={sma.reviewCadence}
              onChange={(event) =>
                updateSma({
                  reviewCadence: event.target.value as "daily" | "weekly",
                })
              }
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <NumberField
            label="Risk-on threshold (%)"
            value={sma.riskOnThresholdPercent}
            step={0.1}
            onChange={(riskOnThresholdPercent) =>
              updateSma({ riskOnThresholdPercent })
            }
          />
          <NumberField
            label="Risk-off threshold (%)"
            value={sma.riskOffThresholdPercent}
            step={0.1}
            onChange={(riskOffThresholdPercent) =>
              updateSma({ riskOffThresholdPercent })
            }
          />
          <NumberField
            label="Model starting capital"
            value={sma.modelStartingCapital}
            min={1}
            onChange={(modelStartingCapital) =>
              updateSma({ modelStartingCapital })
            }
          />
          <NumberField
            label="Transaction cost (%)"
            value={sma.transactionCostPercent}
            min={0}
            step={0.01}
            onChange={(transactionCostPercent) =>
              updateSma({ transactionCostPercent })
            }
          />
          <NumberField
            label="Annual instrument cost (%)"
            value={sma.annualInstrumentCostPercent}
            min={0}
            step={0.01}
            onChange={(annualInstrumentCostPercent) =>
              updateSma({ annualInstrumentCostPercent })
            }
          />
        </div>
      </fieldset>

      <div className="settings-save-bar">
        <span className={`unsaved-indicator ${dirty ? "is-dirty" : ""}`}>
          <i aria-hidden="true" />
          {dirty ? "Unsaved strategy changes" : "Strategy configuration saved"}
        </span>
        {message && <span className="form-message">{message}</span>}
        <button
          type="button"
          className="button button--primary"
          disabled={!canManage || busy || !dirty}
          onClick={save}
        >
          <Save size={16} /> Save strategy configuration
        </button>
      </div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
