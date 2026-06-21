import {
  Copy,
  ListPlus,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  StrategyConfiguration as StrategyConfigurationValue,
  StrategyConfigurationPreset,
  StrategyConfigurationResources,
  TickerCatalogueCategory,
  TickerCatalogueEntry,
} from "../types";
import { Badge } from "./ui";

type Mutate = (
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
) => Promise<unknown>;

const emptyResources: StrategyConfigurationResources = {
  presets: [],
  tickerCatalogue: [],
};

const tickerPattern = /^[A-Z0-9.^=_/-]+$/;
const catalogueCategories: TickerCatalogueCategory[] = [
  "Nasdaq reference",
  "UK leveraged Nasdaq",
  "UK broad equity ETF",
  "UK bond/cash-like/risk-off",
  "Other watchlist",
];
type TickerPairRow =
  StrategyConfigurationValue["strategies"]["dailySuperTrend"]["watchlist"][number];

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
  const [quickTickerId, setQuickTickerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [templateWarning, setTemplateWarning] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(configuration);
  const superTrend = draft.strategies.dailySuperTrend;
  const sma = draft.strategies.nasdaqSma200;
  const resources = configuration.resources ?? emptyResources;
  const enabledCatalogue = resources.tickerCatalogue.filter(
    (entry) => entry.enabled,
  );
  const nasdaqPreset = resources.presets.find(
    (preset) => preset.strategy === "nasdaqSma200",
  );
  const superTrendPreset = resources.presets.find(
    (preset) => preset.strategy === "dailySuperTrend",
  );

  useEffect(() => {
    setDraft(structuredClone(configuration));
    setTemplateWarning("");
    setQuickTickerId(
      (current) =>
        current ||
        configuration.resources?.tickerCatalogue.find((entry) => entry.enabled)
          ?.entryId ||
        "",
    );
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
    values: Partial<TickerPairRow>,
  ) {
    updateSuperTrend({
      watchlist: superTrend.watchlist.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...values } : row,
      ),
    });
  }

  function updateSmaWatchlist(index: number, values: Partial<TickerPairRow>) {
    updateSma({
      watchlist: sma.watchlist.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...values } : row,
      ),
    });
  }

  function loadPreset(preset: StrategyConfigurationPreset | undefined) {
    if (!preset) return;
    const confirmed = window.confirm(
      `Replace the current ${preset.name} form values with this preset? Your saved configuration will not change until you press Save.`,
    );
    if (!confirmed) return;
    setDraft((current) => {
      const next = structuredClone(current);
      if (preset.strategy === "dailySuperTrend") {
        next.strategies.dailySuperTrend = {
          ...preset.configuration.strategies.dailySuperTrend,
          enabled: false,
          watchlist:
            preset.configuration.strategies.dailySuperTrend.watchlist.map(
              (row) => ({ ...row, enabled: false }),
            ),
        };
      } else {
        next.strategies.nasdaqSma200 = {
          ...preset.configuration.strategies.nasdaqSma200,
          enabled: false,
          watchlist: preset.configuration.strategies.nasdaqSma200.watchlist.map(
            (row) => ({ ...row, enabled: false }),
          ),
        };
      }
      return next;
    });
    setMessage("");
    setTemplateWarning(preset.warning);
  }

  function addWatchlistRow(
    row: TickerPairRow,
  ) {
    updateSuperTrend({
      watchlist: [...superTrend.watchlist, row],
    });
  }

  function addSmaWatchlistRow(row: TickerPairRow) {
    updateSma({
      watchlist: [...sma.watchlist, row],
    });
  }

  function addCatalogueTicker() {
    const entry =
      enabledCatalogue.find((item) => item.entryId === quickTickerId) ||
      enabledCatalogue[0];
    if (!entry) {
      setMessage("No catalogue ticker is available yet.");
      return;
    }
    addWatchlistRow({
      signalTicker: entry.marketDataSymbol.toUpperCase(),
      executionTicker: entry.marketDataSymbol.toUpperCase(),
      enabled: false,
      allocationWeight: 1,
    });
    setMessage(`${entry.label} added as a disabled SuperTrend row.`);
  }

  function duplicateWatchlistRow(index: number) {
    const row = superTrend.watchlist[index];
    updateSuperTrend({
      watchlist: [
        ...superTrend.watchlist.slice(0, index + 1),
        { ...row, enabled: false },
        ...superTrend.watchlist.slice(index + 1),
      ],
    });
  }

  function duplicateSmaWatchlistRow(index: number) {
    const row = sma.watchlist[index];
    updateSma({
      watchlist: [
        ...sma.watchlist.slice(0, index + 1),
        { ...row, enabled: false },
        ...sma.watchlist.slice(index + 1),
      ],
    });
  }

  function copySuperTrendRowsToSma() {
    if (
      sma.watchlist.length > 0 &&
      !window.confirm(
        "Replace current SMA200 ticker-pair rows with disabled copies of the SuperTrend universe?",
      )
    ) {
      return;
    }
    updateSma({
      watchlist: superTrend.watchlist.map((row) => ({
        signalTicker: row.signalTicker,
        executionTicker: row.executionTicker,
        enabled: false,
        allocationWeight: 1,
      })),
    });
    setMessage("SuperTrend ticker-pair universe copied into SMA200 as disabled rows.");
  }

  function resetDraft() {
    if (
      dirty &&
      !window.confirm("Reset the form to the last saved strategy configuration?")
    ) {
      return;
    }
    setDraft(structuredClone(configuration));
    setTemplateWarning("");
    setMessage("");
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
            Set up ticker pairs and read-only strategy templates from Settings.
            Review every signal/execution ticker before enabling; presets and
            new rows stay disabled by default.
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
        <div className="strategy-config__quick-setup">
          <div>
            <h3>Quick setup</h3>
            <p>
              Load strategy templates or add ticker-pair catalogue examples here
              in Settings. Nothing is enabled automatically; review each ticker
              before turning a strategy or row on.
            </p>
          </div>
          <div className="strategy-config__quick-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={!nasdaqPreset}
              onClick={() => loadPreset(nasdaqPreset)}
            >
              <ListPlus size={15} /> Load Nasdaq SMA template
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={!superTrendPreset}
              onClick={() => loadPreset(superTrendPreset)}
            >
              <ListPlus size={15} /> Load Daily SuperTrend template
            </button>
            <label className="field strategy-config__catalogue-select">
              <span>Catalogue ticker</span>
              <select
                value={quickTickerId}
                onChange={(event) => setQuickTickerId(event.target.value)}
              >
                {enabledCatalogue.length === 0 && (
                  <option value="">Catalogue unavailable</option>
                )}
                {enabledCatalogue.map((entry) => (
                  <option key={entry.entryId} value={entry.entryId}>
                    {entry.label} · {entry.symbol} → {entry.marketDataSymbol}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button button--secondary"
              onClick={addCatalogueTicker}
            >
              <Plus size={15} /> Add ticker from catalogue
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={resetDraft}
            >
              <RotateCcw size={15} /> Reset current form
            </button>
          </div>
          {templateWarning && (
            <p className="strategy-config__warning">{templateWarning}</p>
          )}
          {canManage && resources.presets.length === 0 && (
            <p className="settings-note">
              Strategy presets are not available in the current dashboard
              payload.
            </p>
          )}
        </div>

        <div className="strategy-config__header">
          <div>
            <h3>Daily SuperTrend</h3>
            <p>Ticker-pair setup for the virtual SuperTrend model.</p>
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
            <h4>SuperTrend ticker-pair mappings</h4>
            <p>
              Choose catalogue tickers or type custom signal and execution
              tickers. Rows stay disabled until you explicitly enable them.
            </p>
          </div>
          <button
            type="button"
            className="button button--secondary"
            onClick={() =>
              addWatchlistRow({
                signalTicker: "",
                executionTicker: "",
                enabled: false,
                allocationWeight: 1,
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {superTrend.watchlist.length === 0 && (
                <tr>
                  <td colSpan={5}>No watchlist mapping configured.</td>
                </tr>
              )}
              {superTrend.watchlist.map((row, index) => {
                const signalError = tickerError(
                  row.signalTicker,
                  row.enabled || superTrend.enabled,
                );
                const executionError = tickerError(
                  row.executionTicker,
                  row.enabled || superTrend.enabled,
                );
                return (
                  <tr key={`${index}-${row.signalTicker}-${row.executionTicker}`}>
                    <td>
                      <input
                        aria-label={`Enable watchlist row ${index + 1}`}
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(event) =>
                          updateWatchlist(index, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                    </td>
                    <td>
                      <TickerPicker
                        label={`Signal ticker ${index + 1}`}
                        value={row.signalTicker}
                        catalogue={enabledCatalogue}
                        error={signalError}
                        onChange={(signalTicker) =>
                          updateWatchlist(index, { signalTicker })
                        }
                      />
                    </td>
                    <td>
                      <TickerPicker
                        label={`Execution ticker ${index + 1}`}
                        value={row.executionTicker}
                        catalogue={enabledCatalogue}
                        error={executionError}
                        onChange={(executionTicker) =>
                          updateWatchlist(index, { executionTicker })
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
                      <div className="strategy-config__row-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Duplicate watchlist row ${index + 1}`}
                          onClick={() => duplicateWatchlistRow(index)}
                        >
                          <Copy size={16} />
                        </button>
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="strategy-config__header">
          <div>
            <h3>Nasdaq SMA200 Regime — 3x</h3>
            <p>Ticker-pair setup for the SMA200 regime template.</p>
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

        <p className="strategy-config__helper">
          The reference ticker drives the SMA200 signal; the risk-on/risk-off
          tickers are execution instruments the virtual model would track after
          you review and enable the template.
        </p>

        <div className="settings-field-grid strategy-config__fields">
          <TickerPicker
            label="Reference ticker"
            value={sma.referenceTicker}
            catalogue={enabledCatalogue}
            categories={["Nasdaq reference", "Other watchlist"]}
            error={tickerError(sma.referenceTicker, sma.enabled)}
            onChange={(referenceTicker) => updateSma({ referenceTicker })}
          />
          <TickerPicker
            label="UK risk-on 3x ticker"
            value={sma.riskOnTicker}
            catalogue={enabledCatalogue}
            categories={["UK leveraged Nasdaq", "Other watchlist"]}
            error={tickerError(sma.riskOnTicker, sma.enabled)}
            onChange={(riskOnTicker) => updateSma({ riskOnTicker })}
          />
          <label className="field">
            <span>Risk-off mode</span>
            <select
              value={sma.riskOffMode}
              onChange={(event) =>
                updateSma({
                  riskOffMode: event.target.value as "cash" | "instrument",
                  riskOffTicker:
                    event.target.value === "cash" ? "" : sma.riskOffTicker,
                })
              }
            >
              <option value="cash">Cash</option>
              <option value="instrument">Instrument</option>
            </select>
          </label>
          {sma.riskOffMode === "instrument" && (
            <TickerPicker
              label="Risk-off ticker"
              value={sma.riskOffTicker}
              catalogue={enabledCatalogue}
              categories={[
                "UK bond/cash-like/risk-off",
                "UK broad equity ETF",
                "Other watchlist",
              ]}
              error={tickerError(sma.riskOffTicker, sma.enabled)}
              onChange={(riskOffTicker) => updateSma({ riskOffTicker })}
            />
          )}
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

        <div className="strategy-config__watchlist-heading">
          <div>
            <h4>SMA200 ticker-pair mappings</h4>
            <p>
              Each enabled row calculates SMA200 on the unleveraged signal
              ticker and holds the leveraged execution ticker when risk-on.
              Rows use equal-weight model sleeves and stay disabled until
              explicitly enabled.
            </p>
          </div>
          <div className="strategy-config__row-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={copySuperTrendRowsToSma}
            >
              <Copy size={15} /> Copy SuperTrend universe
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() =>
                addSmaWatchlistRow({
                  signalTicker: "",
                  executionTicker: "",
                  enabled: false,
                  allocationWeight: 1,
                })
              }
            >
              <Plus size={15} /> Add SMA mapping
            </button>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table strategy-config__watchlist">
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Signal/reference ticker</th>
                <th>Leveraged execution ticker</th>
                <th>Weight</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sma.watchlist.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    No SMA200 multi-ticker rows configured. The legacy
                    single-pair reference/risk-on fields above will be used if
                    the strategy is enabled.
                  </td>
                </tr>
              )}
              {sma.watchlist.map((row, index) => {
                const signalError = tickerError(
                  row.signalTicker,
                  row.enabled || (sma.enabled && sma.watchlist.length > 0),
                );
                const executionError = tickerError(
                  row.executionTicker,
                  row.enabled || (sma.enabled && sma.watchlist.length > 0),
                );
                return (
                  <tr key={`sma-${index}-${row.signalTicker}-${row.executionTicker}`}>
                    <td>
                      <input
                        aria-label={`Enable SMA200 row ${index + 1}`}
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(event) =>
                          updateSmaWatchlist(index, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                    </td>
                    <td>
                      <TickerPicker
                        label={`SMA200 signal ticker ${index + 1}`}
                        value={row.signalTicker}
                        catalogue={enabledCatalogue}
                        categories={[
                          "Nasdaq reference",
                          "UK broad equity ETF",
                          "Other watchlist",
                        ]}
                        error={signalError}
                        onChange={(signalTicker) =>
                          updateSmaWatchlist(index, { signalTicker })
                        }
                      />
                    </td>
                    <td>
                      <TickerPicker
                        label={`SMA200 execution ticker ${index + 1}`}
                        value={row.executionTicker}
                        catalogue={enabledCatalogue}
                        categories={["UK leveraged Nasdaq", "Other watchlist"]}
                        error={executionError}
                        onChange={(executionTicker) =>
                          updateSmaWatchlist(index, { executionTicker })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`SMA200 allocation weight ${index + 1}`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.allocationWeight}
                        onChange={(event) =>
                          updateSmaWatchlist(index, {
                            allocationWeight: Number(event.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <div className="strategy-config__row-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Duplicate SMA200 row ${index + 1}`}
                          onClick={() => duplicateSmaWatchlistRow(index)}
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remove SMA200 row ${index + 1}`}
                          onClick={() =>
                            updateSma({
                              watchlist: sma.watchlist.filter(
                                (_, rowIndex) => rowIndex !== index,
                              ),
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

function tickerError(value: string, required: boolean) {
  const ticker = value.trim().toUpperCase();
  if (required && !ticker) return "Ticker is required before enabling.";
  if (ticker && !tickerPattern.test(ticker)) {
    return "Use letters, numbers, '.', '^', '=', '_', '/', or '-'.";
  }
  return "";
}

function TickerPicker({
  label,
  value,
  catalogue,
  categories,
  error,
  onChange,
}: {
  label: string;
  value: string;
  catalogue: TickerCatalogueEntry[];
  categories?: TickerCatalogueCategory[];
  error?: string;
  onChange: (value: string) => void;
}) {
  const filteredCatalogue = categories
    ? catalogue.filter((entry) => categories.includes(entry.category))
    : catalogue;
  const selectedEntry =
    filteredCatalogue.find(
      (entry) =>
        entry.marketDataSymbol.toUpperCase() === value.trim().toUpperCase(),
    )?.entryId ?? "";

  return (
    <div className={`field ticker-picker ${error ? "field--error" : ""}`}>
      <span>{label}</span>
      <select
        aria-label={`${label} catalogue`}
        value={selectedEntry}
        onChange={(event) => {
          const entry = filteredCatalogue.find(
            (item) => item.entryId === event.target.value,
          );
          if (entry) onChange(entry.marketDataSymbol.toUpperCase());
        }}
      >
        <option value="">Choose from catalogue</option>
        {catalogueCategories.map((category) => {
          const entries = filteredCatalogue.filter(
            (entry) => entry.category === category,
          );
          if (!entries.length) return null;
          return (
            <optgroup key={category} label={category}>
              {entries.map((entry) => (
                <option key={entry.entryId} value={entry.entryId}>
                  {entry.label} · {entry.symbol} → {entry.marketDataSymbol}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      <input
        aria-label={`${label} custom ticker`}
        placeholder="Or type custom ticker"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
      <small>
        Display and market-data symbols can differ; save the market-data ticker
        the scanner should read.
      </small>
      {error && <small className="field-error">{error}</small>}
    </div>
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
