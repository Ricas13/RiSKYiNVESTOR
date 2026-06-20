import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  DatabaseBackup,
  Eye,
  KeyRound,
  MessageCircle,
  Save,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AuthSession,
  DataCleanupPreview,
  DataClassification,
  DataStatusReport,
  NotificationPublicState,
  NotificationSettings,
  StrategyConfiguration as StrategyConfigurationValue,
} from "../types";
import { DataPortability } from "./DataPortability";
import { DiscordDestinations } from "./DiscordDestinations";
import { NotificationHistory } from "./SignalEvents";
import { StrategyConfiguration } from "./StrategyConfiguration";
import { StrategyNotificationPolicies } from "./StrategyNotificationPolicies";
import { Badge, SectionHeader } from "./ui";

type Mutate = (
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
) => Promise<unknown>;

interface NotificationResult {
  status?: string;
  preview?: string;
  reason?: string | null;
}

export function SettingsPage({
  notifications,
  strategyConfiguration,
  session,
  dataStatus,
  mutate,
  download,
  request,
}: {
  notifications: NotificationPublicState;
  strategyConfiguration: StrategyConfigurationValue;
  session: AuthSession;
  dataStatus: DataStatusReport;
  mutate: Mutate;
  download: (path: string, filename: string) => Promise<void>;
  request: <T>(path: string) => Promise<T>;
}) {
  const [settings, setSettings] = useState<NotificationSettings>(
    notifications.settings,
  );
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty =
    JSON.stringify(settings) !== JSON.stringify(notifications.settings);

  useEffect(() => setSettings(notifications.settings), [notifications.settings]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function set<K extends keyof NotificationSettings>(
    key: K,
    value: NotificationSettings[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function run(
    action: () => Promise<unknown>,
    success: string,
    showPreview = false,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const result = (await action()) as NotificationResult;
      setMessage(
        result.reason
          ? `${success} ${result.reason}`
          : result.status
            ? `${success} Status: ${result.status}.`
            : success,
      );
      if (showPreview) setPreview(result.preview ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="control-page-stack">
      <DataStatusOnboarding
        report={dataStatus}
        session={session}
        mutate={mutate}
        download={download}
        request={request}
      />

      <StrategyConfiguration
        configuration={strategyConfiguration}
        canManage={session.role === "owner" || session.role === "admin"}
        mutate={mutate}
      />

      <SectionHeader
        eyebrow="Notifications"
        title="Server-side delivery controls"
        copy="Discord delivery uses canonical signal events and portfolio snapshots. Credentials stay on the server and are never returned to this page."
      />

      <DiscordDestinations
        destinations={notifications.providers.discord.destinations}
        legacyDestination={
          notifications.providers.discord.legacyDestination
        }
        mutate={mutate}
      />

      <StrategyNotificationPolicies
        value={settings.strategyPolicies}
        destinations={notifications.providers.discord.destinations}
        onChange={(strategyPolicies) => set("strategyPolicies", strategyPolicies)}
      />

      <div className="settings-grid">
        <section className="settings-card settings-card--muted">
          <div className="settings-card__heading">
            <MessageCircle size={20} />
            <div>
              <h2>WhatsApp not connected</h2>
              <p>No WhatsApp provider or delivery integration is present.</p>
            </div>
            <Badge tone="blue">DISABLED</Badge>
          </div>
          <Toggle
            label="WhatsApp notifications"
            checked={settings.whatsapp.enabled}
            disabled
            onChange={() => undefined}
          />
          <p className="settings-note">
            No WhatsApp credentials are accepted and no API calls are made.
          </p>
        </section>
      </div>

      <section className="settings-card">
        <div className="settings-card__heading">
          <ShieldCheck size={20} />
          <div>
            <h2>Controlled migration</h2>
            <p>Keep only one live Discord sender enabled during cutover.</p>
          </div>
        </div>
        <Toggle
          label="Enable Discord notifications"
          checked={settings.discord.enabled}
          onChange={(enabled) =>
            set("discord", { ...settings.discord, enabled })
          }
        />
        <Toggle
          label="Legacy scanner Discord is enabled"
          checked={settings.migration.legacyScannerDiscordEnabled}
          onChange={(legacyScannerDiscordEnabled) =>
            set("migration", {
              ...settings.migration,
              legacyScannerDiscordEnabled,
            })
          }
        />
        <Toggle
          label="Canonical dashboard Discord is enabled"
          checked={settings.migration.canonicalDashboardDiscordEnabled}
          onChange={(canonicalDashboardDiscordEnabled) =>
            set("migration", {
              ...settings.migration,
              canonicalDashboardDiscordEnabled,
            })
          }
        />
        <Toggle
          label="Allow legacy server destination alongside UI-managed destinations"
          checked={
            settings.migration.legacyServerDiscordAlongsideManaged
          }
          onChange={(legacyServerDiscordAlongsideManaged) =>
            set("migration", {
              ...settings.migration,
              legacyServerDiscordAlongsideManaged,
            })
          }
        />
        <p className="settings-note">
          This dashboard flag gates canonical delivery. The legacy scanner flag
          is an operator record; set the matching scanner environment flag
          separately during migration.
        </p>
      </section>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card__heading">
            <BellRing size={20} />
            <div>
              <h2>Signal alerts</h2>
              <p>Choose which canonical event states may reach Discord.</p>
            </div>
          </div>
          {[
            ["entry", "Actionable entry"],
            ["exit", "Actionable exit"],
            ["lowLiquidity", "Low-liquidity warning"],
            ["scannerError", "Scanner error"],
            ["watchlistOnly", "Watchlist only"],
            ["dailySummary", "Daily summary"],
          ].map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              checked={
                settings.signalAlerts[
                  key as keyof NotificationSettings["signalAlerts"]
                ]
              }
              onChange={(checked) =>
                set("signalAlerts", {
                  ...settings.signalAlerts,
                  [key]: checked,
                })
              }
            />
          ))}
          <Toggle
            label="Only warn on low liquidity when eligible"
            checked={settings.thresholds.lowLiquidityOnlyWhenActionable}
            onChange={(lowLiquidityOnlyWhenActionable) =>
              set("thresholds", {
                ...settings.thresholds,
                lowLiquidityOnlyWhenActionable,
              })
            }
          />
        </section>

        <section className="settings-card">
          <div className="settings-card__heading">
            <Clock3 size={20} />
            <div>
              <h2>Quiet hours</h2>
              <p>Suppress routine signal and summary delivery.</p>
            </div>
          </div>
          <Toggle
            label="Enable quiet hours"
            checked={settings.quietHours.enabled}
            onChange={(enabled) =>
              set("quietHours", { ...settings.quietHours, enabled })
            }
          />
          <div className="settings-field-grid">
            <label className="field">
              <span>Start</span>
              <input
                type="time"
                value={settings.quietHours.start}
                onChange={(event) =>
                  set("quietHours", {
                    ...settings.quietHours,
                    start: event.target.value,
                  })
                }
              />
            </label>
            <label className="field">
              <span>End</span>
              <input
                type="time"
                value={settings.quietHours.end}
                onChange={(event) =>
                  set("quietHours", {
                    ...settings.quietHours,
                    end: event.target.value,
                  })
                }
              />
            </label>
            <label className="field field--full">
              <span>Timezone</span>
              <input
                value={settings.quietHours.timezone}
                onChange={(event) =>
                  set("quietHours", {
                    ...settings.quietHours,
                    timezone: event.target.value,
                  })
                }
              />
            </label>
          </div>
        </section>
      </div>

      <section className="settings-card">
        <div className="settings-card__heading">
          <Clock3 size={20} />
          <div>
            <h2>Daily P/L summary</h2>
            <p>Scheduled server-side from the latest canonical snapshot.</p>
          </div>
        </div>
        <Toggle
          label="Enable daily P/L summary"
          checked={settings.dailySummary.enabled}
          onChange={(enabled) =>
            set("dailySummary", { ...settings.dailySummary, enabled })
          }
        />
        <Toggle
          label="Allow summaries when scanner data is stale"
          checked={settings.dailySummary.sendStaleSummaries}
          onChange={(sendStaleSummaries) =>
            set("dailySummary", {
              ...settings.dailySummary,
              sendStaleSummaries,
            })
          }
        />
        <div className="settings-field-grid">
          <label className="field">
            <span>Report time</span>
            <input
              type="time"
              value={settings.dailySummary.time}
              onChange={(event) =>
                set("dailySummary", {
                  ...settings.dailySummary,
                  time: event.target.value,
                })
              }
            />
          </label>
          <label className="field">
            <span>Timezone</span>
            <input
              value={settings.dailySummary.timezone}
              onChange={(event) =>
                set("dailySummary", {
                  ...settings.dailySummary,
                  timezone: event.target.value,
                })
              }
            />
          </label>
          <label className="field">
            <span>Minimum absolute daily P/L ({"\u00a3"})</span>
            <input
              type="number"
              min="0"
              value={settings.thresholds.minimumAbsoluteDailyPL}
              onChange={(event) =>
                set("thresholds", {
                  ...settings.thresholds,
                  minimumAbsoluteDailyPL: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="field">
            <span>Minimum daily P/L (%)</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={settings.thresholds.minimumDailyPLPercent}
              onChange={(event) =>
                set("thresholds", {
                  ...settings.thresholds,
                  minimumDailyPLPercent: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
        <div className="metric-toggle-grid">
          {[
            ["actualPortfolioValue", "Actual portfolio value"],
            ["modelPortfolioValue", "Model portfolio value"],
            ["actualPL", "Actual P/L"],
            ["modelPL", "Model P/L"],
            ["realisedPL", "Realised P/L"],
            ["unrealisedPL", "Unrealised P/L"],
            ["contributionsWithdrawals", "Contributions / withdrawals"],
            ["drawdown", "Drawdown"],
            ["cashInvested", "Cash / invested"],
            ["latestActionableSignal", "Latest actionable signal"],
            ["scannerFreshness", "Scanner freshness"],
          ].map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              checked={
                settings.dailySummary.metrics[
                  key as keyof NotificationSettings["dailySummary"]["metrics"]
                ]
              }
              onChange={(checked) =>
                set("dailySummary", {
                  ...settings.dailySummary,
                  metrics: {
                    ...settings.dailySummary.metrics,
                    [key]: checked,
                  },
                })
              }
            />
          ))}
        </div>
        <div className="settings-actions">
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  mutate("/notifications/daily-summary/dry-run", "POST", {
                    force: true,
                    recordDryRun: false,
                  }),
                "Daily summary preview generated.",
                true,
              )
            }
          >
            <Send size={15} /> Preview daily summary
          </button>
        </div>
        {preview && <pre className="config-viewer">{preview}</pre>}
      </section>

      <section className="settings-card settings-card--muted">
        <div className="settings-card__heading">
          <Clock3 size={20} />
          <div>
            <h2>Weekly summary</h2>
            <p>Settings skeleton only; automatic delivery remains disabled.</p>
          </div>
          <Badge tone="blue">NOT SCHEDULED</Badge>
        </div>
        <Toggle
          label="Prepare weekly summary configuration"
          checked={settings.weeklySummary.enabled}
          onChange={(enabled) =>
            set("weeklySummary", { ...settings.weeklySummary, enabled })
          }
        />
      </section>

      <div className="settings-save-bar">
        <span className={`unsaved-indicator ${dirty ? "is-dirty" : ""}`}>
          <i aria-hidden="true" />
          {dirty ? "Unsaved notification changes" : "Notifications saved"}
        </span>
        {message && <span className="form-message">{message}</span>}
        <button
          className="button button--primary"
          disabled={busy || !dirty}
          onClick={() =>
            run(
              () => mutate("/notification-settings", "PUT", settings),
              "Notification settings saved.",
            )
          }
        >
          <Save size={16} /> Save notification settings
        </button>
      </div>

      <SectionHeader
        eyebrow="Delivery history"
        title="Recent notification attempts"
        copy={`${notifications.retention.retained} retained of ${notifications.retention.maximum} configured records.`}
      />
      <NotificationHistory deliveries={notifications.deliveries} limit={20} />

      <SectionHeader
        eyebrow="Authentication"
        title="Password and session controls"
        copy="Authentication remains server-managed and unchanged by this refactor."
      />
      <div className="auth-settings-grid">
        <article>
          <ShieldCheck size={19} />
          <span>Signed-in account</span>
          <strong>{session.username}</strong>
          <p>Role: {session.role}</p>
        </article>
        <article>
          <CheckCircle2 size={19} />
          <span>Session protection</span>
          <strong>HTTP-only + CSRF</strong>
          <p>Use Log out in the sidebar to end this browser session.</p>
        </article>
        <article>
          <KeyRound size={19} />
          <span>Password management</span>
          <strong>Server configuration</strong>
          <p>Password hashes and session secrets are never returned to the UI.</p>
        </article>
      </div>

      <SectionHeader
        eyebrow="Data portability"
        title="Export, import and backup"
        copy="Portable owner records remain available without exposing notification credentials."
      />
      <DataPortability download={download} mutate={mutate} />
    </div>
  );
}

function DataStatusOnboarding({
  report,
  session,
  mutate,
  download,
  request,
}: {
  report: DataStatusReport;
  session: AuthSession;
  mutate: Mutate;
  download: (path: string, filename: string) => Promise<void>;
  request: <T>(path: string) => Promise<T>;
}) {
  const [preview, setPreview] = useState<DataCleanupPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const currentReport = preview?.report ?? report;
  const canClean = session.role === "owner" || session.role === "admin";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }

  function tone(value: DataClassification) {
    if (value === "Demo" || value === "Mixed") return "amber" as const;
    if (value === "Live") return "green" as const;
    if (value === "Unknown \u2014 requires review") return "red" as const;
    return "blue" as const;
  }

  return (
    <section className="data-onboarding">
      <div className="data-onboarding__heading">
        <div>
          <span>Data safety</span>
          <h1>Data status and onboarding</h1>
          <p>
            Demo markers are classified conservatively. Unmarked historical
            content is preserved for review, never silently deleted.
          </p>
        </div>
        <Badge tone={currentReport.hasDemoData ? "amber" : "green"}>
          {currentReport.hasDemoData ? "DEMO PRESENT" : "NO DEMO DETECTED"}
        </Badge>
      </div>

      <div className="data-status-grid">
        {currentReport.areas.map((area) => (
          <article className="data-status-card" key={area.id}>
            <div>
              <h3>{area.label}</h3>
              <Badge tone={tone(area.classification)}>
                {area.classification}
              </Badge>
            </div>
            <strong>{area.recordCount} records</strong>
            <p>{area.explanation}</p>
            <small>
              Demo {area.demoCount} {"\u00b7"} Live {area.liveCount} {"\u00b7"} Review{" "}
              {area.unknownCount}
            </small>
          </article>
        ))}
      </div>

      <div className="cleanup-workflow">
        <div className="cleanup-workflow__intro">
          <AlertTriangle size={22} />
          <div>
            <h2>Safe demo-data cleanup</h2>
            <p>
              Only explicit demo markers and exact fingerprints of shipped demo
              fixtures are removed. Genuine and unknown records remain intact.
            </p>
          </div>
        </div>

        {!canClean ? (
          <p className="settings-note">
            Owner or admin access is required to preview backups or remove demo
            data.
          </p>
        ) : (
          <div className="cleanup-steps">
            <article>
              <span>1</span>
              <div>
                <h3>Preview removal</h3>
                <p>Validate every affected private JSON file before any write.</p>
              </div>
              <button
                className="button button--secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await request<DataCleanupPreview>(
                      "/data-cleanup/preview",
                    );
                    setPreview(result);
                    setMessage(
                      `${result.report.totals.demo} demo records are eligible for cleanup.`,
                    );
                  })
                }
              >
                <Eye size={15} /> Preview
              </button>
            </article>

            <article>
              <span>2</span>
              <div>
                <h3>Download required backup</h3>
                <p>
                  The server accepts cleanup only for 30 minutes after this
                  pre-cleanup backup is generated.
                </p>
              </div>
              <button
                className="button button--secondary"
                disabled={busy || !preview}
                onClick={() =>
                  run(async () => {
                    await download(
                      "/data-cleanup/backup",
                      "risky-investor-pre-cleanup-backup.json",
                    );
                    setPreview((current) =>
                      current
                        ? { ...current, backupDownloaded: true }
                        : current,
                    );
                    setMessage("Required backup downloaded.");
                  })
                }
              >
                <DatabaseBackup size={15} /> Download backup
              </button>
            </article>

            <article className="cleanup-confirmation">
              <span>3</span>
              <div>
                <h3>Confirm exact phrase</h3>
                <p>
                  Type <code>REMOVE DEMO DATA</code>. Cleanup is audited and is
                  never run automatically.
                </p>
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="REMOVE DEMO DATA"
                  autoComplete="off"
                />
              </div>
              <button
                className="button button--danger"
                disabled={
                  busy ||
                  !preview?.backupDownloaded ||
                  confirmation !== "REMOVE DEMO DATA" ||
                  !currentReport.hasDemoData
                }
                onClick={() =>
                  run(async () => {
                    const result = (await mutate("/data-cleanup", "POST", {
                      confirmation,
                    })) as {
                      totalRemoved: number;
                      report: DataStatusReport;
                    };
                    setPreview({
                      report: result.report,
                      confirmationText: "REMOVE DEMO DATA",
                      backupDownloaded: false,
                      backupReceiptExpiresMinutes: 30,
                    });
                    setConfirmation("");
                    setMessage(
                      `${result.totalRemoved} demo records removed. Unknown and live records were preserved.`,
                    );
                  })
                }
              >
                <Trash2 size={15} /> Remove demo data
              </button>
            </article>
          </div>
        )}
        {message && <div className="form-message">{message}</div>}
      </div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`toggle-row ${disabled ? "toggle-row--disabled" : ""}`}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}