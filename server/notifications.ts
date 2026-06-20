import { randomUUID } from "node:crypto";
import {
  DiscordDestinationManager,
  type DiscordDeliveryTarget,
} from "./discordDestinations.js";
import {
  applyWebhookIdentity,
  dailySummaryDiscordPayload,
  signalDiscordPayload,
  testDiscordPayload,
  validateDiscordPayload,
  type DiscordWebhookPayload,
} from "./discordEmbeds.js";
import { JsonStore } from "./store.js";
import {
  AlertDeliveryRepository,
  type AlertDelivery,
  type AlertDeliveryStatus,
  type DailyPortfolioSnapshot,
  type SignalEvent,
  type SignalState,
} from "./signalEvents.js";

export interface NotificationSettings {
  version: 2;
  isExample: boolean;
  discord: { enabled: boolean };
  whatsapp: { enabled: boolean; provider: "stub" };
  migration: {
    legacyScannerDiscordEnabled: boolean;
    canonicalDashboardDiscordEnabled: boolean;
    legacyServerDiscordAlongsideManaged: boolean;
  };
  signalAlerts: {
    entry: boolean;
    exit: boolean;
    lowLiquidity: boolean;
    scannerError: boolean;
    watchlistOnly: boolean;
    dailySummary: boolean;
    weeklySummary: boolean;
  };
  dailySummary: {
    enabled: boolean;
    time: string;
    timezone: string;
    sendStaleSummaries: boolean;
    lastSentDate: string | null;
    metrics: {
      actualPortfolioValue: boolean;
      modelPortfolioValue: boolean;
      actualPL: boolean;
      modelPL: boolean;
      realisedPL: boolean;
      unrealisedPL: boolean;
      contributionsWithdrawals: boolean;
      drawdown: boolean;
      cashInvested: boolean;
      latestActionableSignal: boolean;
      scannerFreshness: boolean;
    };
  };
  weeklySummary: {
    enabled: boolean;
    automaticDeliveryEnabled: false;
    dayOfWeek: number;
    time: string;
    timezone: string;
  };
  thresholds: {
    minimumAbsoluteDailyPL: number;
    minimumDailyPLPercent: number;
    lowLiquidityOnlyWhenActionable: boolean;
  };
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
  retention: {
    maximumDeliveries: number;
  };
}

export interface DailyPLReport {
  reportDate: string;
  actualDailyPL: number;
  actualDailyPLPercent: number;
  actualTotalPL: number;
  modelDailyPLPercent: number;
  modelTotalPLPercent: number;
  realisedPL: number;
  unrealisedPL: number;
  contributions: number;
  withdrawals: number;
  drawdownPercent: number;
  actionableSignalEvents: number;
}

export function safeNotificationError(error: unknown) {
  const raw =
    error instanceof Error ? error.message : "Notification delivery failed.";
  return raw
    .replace(
      /https?:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\S+/gi,
      "[redacted webhook]",
    )
    .replace(
      /\b(?:token|secret|password|api[_-]?key|webhook)\s*[=:]\s*[^\s,;]+/gi,
      "[redacted credential]",
    )
    .slice(0, 1_000);
}

export interface DailySummaryContext {
  snapshot: DailyPortfolioSnapshot | null;
  latestActionableEvent: SignalEvent | null;
  scanner: {
    status: "awaiting" | "current" | "stale" | "error";
    lastSuccessfulScanAt: string | null;
    staleAfterMinutes: number;
    summary?: string | null;
    importedEvents?: number;
    warningCount?: number;
    errorCount?: number;
    watchlist?: Array<{
      tradeTicker?: string;
      underlyingTicker?: string;
      currentTrend?: string;
    }>;
  };
}

export interface DailySummaryResult {
  status: AlertDeliveryStatus;
  preview: string;
  reason: string | null;
  delivery: AlertDelivery | null;
}

function clockMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function timezone(value: string, fallback = "Europe/London") {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format();
    return value;
  } catch {
    return fallback;
  }
}

export function zonedClock(now: Date, timezoneValue: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezoneValue,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function isQuiet(settings: NotificationSettings, now = new Date()) {
  if (!settings.quietHours.enabled) return false;
  const current = zonedClock(now, settings.quietHours.timezone).minutes;
  const start = clockMinutes(settings.quietHours.start);
  const end = clockMinutes(settings.quietHours.end);
  return start <= end
    ? current >= start && current < end
    : current >= start || current < end;
}

function toggleFor(eventType: SignalState, settings: NotificationSettings) {
  if (eventType === "actionable_entry") return settings.signalAlerts.entry;
  if (eventType === "actionable_exit") return settings.signalAlerts.exit;
  if (eventType === "low_liquidity_warning") {
    return settings.signalAlerts.lowLiquidity;
  }
  if (eventType === "scanner_error") return settings.signalAlerts.scannerError;
  if (eventType === "watchlist_only") {
    return settings.signalAlerts.watchlistOnly;
  }
  return false;
}

function money(value: number | null) {
  if (value === null) return "unavailable";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(value);
}

function percent(value: number | null) {
  return value === null ? "unavailable" : `${value.toFixed(2)}%`;
}

function normaliseSettings(value: Partial<NotificationSettings>) {
  const dailyMetrics = value.dailySummary?.metrics;
  return {
    version: 2,
    isExample: false,
    discord: { enabled: Boolean(value.discord?.enabled) },
    whatsapp: { enabled: false, provider: "stub" as const },
    migration: {
      legacyScannerDiscordEnabled:
        value.migration?.legacyScannerDiscordEnabled !== false,
      canonicalDashboardDiscordEnabled: Boolean(
        value.migration?.canonicalDashboardDiscordEnabled,
      ),
      legacyServerDiscordAlongsideManaged: Boolean(
        value.migration?.legacyServerDiscordAlongsideManaged,
      ),
    },
    signalAlerts: {
      entry: value.signalAlerts?.entry !== false,
      exit: value.signalAlerts?.exit !== false,
      lowLiquidity: value.signalAlerts?.lowLiquidity !== false,
      scannerError: value.signalAlerts?.scannerError !== false,
      watchlistOnly: Boolean(value.signalAlerts?.watchlistOnly),
      dailySummary: value.signalAlerts?.dailySummary !== false,
      weeklySummary: Boolean(value.signalAlerts?.weeklySummary),
    },
    dailySummary: {
      enabled: Boolean(value.dailySummary?.enabled),
      time: /^\d{2}:\d{2}$/.test(value.dailySummary?.time ?? "")
        ? value.dailySummary!.time
        : "21:15",
      timezone: timezone(value.dailySummary?.timezone || "Europe/London"),
      sendStaleSummaries: Boolean(value.dailySummary?.sendStaleSummaries),
      lastSentDate: value.dailySummary?.lastSentDate ?? null,
      metrics: {
        actualPortfolioValue:
          dailyMetrics?.actualPortfolioValue !== false,
        modelPortfolioValue:
          dailyMetrics?.modelPortfolioValue !== false,
        actualPL: dailyMetrics?.actualPL !== false,
        modelPL: dailyMetrics?.modelPL !== false,
        realisedPL: dailyMetrics?.realisedPL !== false,
        unrealisedPL: dailyMetrics?.unrealisedPL !== false,
        contributionsWithdrawals:
          dailyMetrics?.contributionsWithdrawals !== false,
        drawdown: dailyMetrics?.drawdown !== false,
        cashInvested: dailyMetrics?.cashInvested !== false,
        latestActionableSignal:
          dailyMetrics?.latestActionableSignal !== false,
        scannerFreshness: dailyMetrics?.scannerFreshness !== false,
      },
    },
    weeklySummary: {
      enabled: Boolean(value.weeklySummary?.enabled),
      automaticDeliveryEnabled: false as const,
      dayOfWeek: Math.min(
        6,
        Math.max(0, Math.floor(value.weeklySummary?.dayOfWeek ?? 5)),
      ),
      time: /^\d{2}:\d{2}$/.test(value.weeklySummary?.time ?? "")
        ? value.weeklySummary!.time
        : "18:00",
      timezone: timezone(value.weeklySummary?.timezone || "Europe/London"),
    },
    thresholds: {
      minimumAbsoluteDailyPL: Math.max(
        0,
        Number(value.thresholds?.minimumAbsoluteDailyPL) || 0,
      ),
      minimumDailyPLPercent: Math.max(
        0,
        Number(value.thresholds?.minimumDailyPLPercent) || 0,
      ),
      lowLiquidityOnlyWhenActionable: Boolean(
        value.thresholds?.lowLiquidityOnlyWhenActionable,
      ),
    },
    quietHours: {
      enabled: Boolean(value.quietHours?.enabled),
      start: /^\d{2}:\d{2}$/.test(value.quietHours?.start ?? "")
        ? value.quietHours!.start
        : "22:00",
      end: /^\d{2}:\d{2}$/.test(value.quietHours?.end ?? "")
        ? value.quietHours!.end
        : "07:00",
      timezone: timezone(value.quietHours?.timezone || "Europe/London"),
    },
    retention: {
      maximumDeliveries: Math.min(
        5_000,
        Math.max(100, Math.floor(value.retention?.maximumDeliveries ?? 1_000)),
      ),
    },
  } satisfies NotificationSettings;
}

function signalMessage(event: SignalEvent) {
  const heading =
    event.signalState === "actionable_entry"
      ? "ACTIONABLE ENTRY"
      : event.signalState === "actionable_exit"
        ? "ACTIONABLE EXIT"
        : event.signalState.replaceAll("_", " ").toUpperCase();
  return [
    `Risky Investor \u00b7 ${heading}`,
    `${event.underlyingTicker} \u2192 ${event.tradeTicker}`,
    event.reasonText,
    `Trend: ${event.previousTrend} \u2192 ${event.currentTrend}`,
    `Tier: ${event.riskTier} \u00b7 Eligibility: ${event.eligibility}`,
    `Allocation: ${event.allocationPercent}% (${event.allocationStatus})`,
    `Occurred: ${event.occurredAt}`,
    `Event: ${event.eventId}`,
    "Private tracking only. Verify manually before acting.",
  ].join("\n");
}

export class NotificationDispatcher {
  constructor(
    private readonly store: JsonStore,
    private readonly deliveries: AlertDeliveryRepository,
    private readonly destinations: DiscordDestinationManager,
  ) {}

  async settings() {
    const raw = await this.store.read<Partial<NotificationSettings>>(
      "notification_settings.json",
    );
    return normaliseSettings(raw);
  }

  async publicState() {
    const [settings, deliveryHistory, managedDestinations] =
      await Promise.all([
        this.settings(),
        this.deliveries.read(),
        this.destinations.publicDestinations(),
      ]);
    const managedEnabled = managedDestinations.filter(
      (destination) => destination.enabled,
    );
    const legacyDelivery = deliveryHistory.find(
      (delivery) =>
        delivery.destinationId === "legacy-server-configured",
    );
    const legacyEnabled =
      managedEnabled.length === 0 ||
      settings.migration.legacyServerDiscordAlongsideManaged;
    const legacyDestination = this.destinations.publicLegacyDestination(
      legacyEnabled,
      {
        lastTestAt:
          legacyDelivery?.category === "test"
            ? legacyDelivery.attemptedAt
            : null,
        lastSuccessfulDeliveryAt:
          legacyDelivery?.status === "sent"
            ? legacyDelivery.deliveredAt
            : null,
        latestResult: legacyDelivery?.status ?? null,
      },
    );
    const allDestinations = [
      ...managedDestinations,
      ...(legacyDestination ? [legacyDestination] : []),
    ];
    const lastSuccess = deliveryHistory.find(
      (delivery) =>
        (delivery.channel === "discord" ||
          delivery.channel === "daily_summary") &&
        delivery.status === "sent",
    );
    const latestDiscord = deliveryHistory.find(
      (delivery) =>
        delivery.channel === "discord" ||
        delivery.channel === "daily_summary",
    );
    return {
      settings,
      providers: {
        discord: {
          configured: allDestinations.length > 0,
          available: true,
          maskedEnding:
            allDestinations[0]?.maskedEnding ?? null,
          lastSuccessfulDeliveryAt: lastSuccess?.deliveredAt ?? null,
          latestResult: latestDiscord?.status ?? null,
          destinations: managedDestinations,
          legacyDestination,
        },
        whatsapp: {
          configured: false,
          available: false,
          maskedEnding: null,
          lastSuccessfulDeliveryAt: null,
          latestResult: null,
        },
      },
      retention: {
        retained: deliveryHistory.length,
        maximum: settings.retention.maximumDeliveries,
      },
      deliveries: deliveryHistory.slice(0, 100),
    };
  }

  async updateSettings(value: Partial<NotificationSettings>) {
    const current = await this.settings();
    const settings = normaliseSettings({
      ...current,
      ...value,
      discord: { ...current.discord, ...value.discord },
      migration: { ...current.migration, ...value.migration },
      signalAlerts: {
        ...current.signalAlerts,
        ...value.signalAlerts,
      },
      dailySummary: {
        ...current.dailySummary,
        ...value.dailySummary,
        metrics: {
          ...current.dailySummary.metrics,
          ...value.dailySummary?.metrics,
        },
      },
      weeklySummary: {
        ...current.weeklySummary,
        ...value.weeklySummary,
      },
      thresholds: {
        ...current.thresholds,
        ...value.thresholds,
      },
      quietHours: {
        ...current.quietHours,
        ...value.quietHours,
      },
      retention: {
        ...current.retention,
        ...value.retention,
      },
    });
    await this.store.write("notification_settings.json", settings);
    await this.deliveries.prune(settings.retention.maximumDeliveries);
    return settings;
  }

  async dispatchSignal(event: SignalEvent, force = false) {
    if (
      event.signalState === "no_change" ||
      event.signalState === "informational" ||
      event.signalState === "wait_review"
    ) {
      return null;
    }
    const settings = await this.settings();
    let blockedStatus: AlertDeliveryStatus | null = null;
    let blockedReason: string | null = null;
    if (!settings.migration.canonicalDashboardDiscordEnabled) {
      blockedStatus = "disabled";
      blockedReason = "Canonical dashboard Discord is disabled.";
    } else if (!settings.discord.enabled) {
      blockedStatus = "disabled";
      blockedReason = "Discord notifications are disabled.";
    } else if (!event.discordDeliveryEligible) {
      blockedStatus = "skipped";
      blockedReason = "Scanner marked the event ineligible for Discord.";
    } else if (!toggleFor(event.signalState, settings)) {
      blockedStatus = "disabled";
      blockedReason = `Discord alerts are disabled for ${event.signalState}.`;
    } else if (
      event.signalState === "low_liquidity_warning" &&
      settings.thresholds.lowLiquidityOnlyWhenActionable &&
      event.eligibility !== "eligible"
    ) {
      blockedStatus = "skipped";
      blockedReason = "Low-liquidity warning did not meet the alert threshold.";
    } else if (isQuiet(settings)) {
      blockedStatus = "skipped";
      blockedReason = "Quiet hours are active.";
    }

    const message = signalMessage(event);
    if (blockedStatus) {
      return this.recordFinal({
        notificationKey: `discord:signal:${event.eventId}:gated`,
        eventId: event.eventId,
        channel: "discord",
        category: "signal",
        status: blockedStatus,
        message,
        errorMessage: blockedReason,
        retryCount: 0,
      });
    }
    const targets = await this.destinations.deliveryTargets(
      settings.migration.legacyServerDiscordAlongsideManaged,
    );
    if (!targets.length) {
      return this.recordFinal({
        notificationKey: `discord:signal:${event.eventId}:unconfigured`,
        eventId: event.eventId,
        channel: "discord",
        category: "signal",
        status: "disabled",
        message,
        errorMessage: "Discord destination is not configured or enabled.",
        retryCount: 0,
      });
    }
    const payload = validateDiscordPayload(signalDiscordPayload(event));
    const results: AlertDelivery[] = [];
    for (const target of targets) {
      const notificationKey =
        `discord:signal:${event.eventId}:${target.destinationId}`;
      const existing = await this.deliveries.findByKey(notificationKey);
      results.push(
        existing && !force
          ? existing
          : await this.attempt({
          notificationKey,
          eventId: event.eventId,
          channel: "discord",
          category: "signal",
          message,
          payload,
          target,
          retryCount: existing?.retryCount ?? 0,
          existingDeliveryId: existing?.deliveryId,
            }),
      );
    }
    return results[0] ?? null;
  }

  async testDiscord(destinationId?: string, dryRun = false) {
    const message = "Risky Investor notification test \u2014 no trading action.";
    if (dryRun) {
      return {
        status: "skipped" as const,
        preview: message,
        delivery: null,
      };
    }
    if (!destinationId) {
      const settings = await this.settings();
      destinationId = (
        await this.destinations.deliveryTargets(
          settings.migration.legacyServerDiscordAlongsideManaged,
        )
      )[0]?.destinationId;
    }
    if (!destinationId) {
      const delivery = await this.recordFinal({
        notificationKey: `discord:test:unconfigured:${randomUUID()}`,
        eventId: null,
        channel: "discord",
        category: "test",
        status: "disabled",
        message,
        errorMessage: "Discord destination is not configured or enabled.",
        retryCount: 0,
      });
      return { status: delivery.status, preview: message, delivery };
    }
    const target = await this.destinations.target(destinationId);
    const delivery = await this.attempt({
      notificationKey: `discord:test:${destinationId}:${randomUUID()}`,
      eventId: null,
      channel: "discord",
      category: "test",
      message,
      payload: validateDiscordPayload(testDiscordPayload()),
      target,
      retryCount: 0,
      tested: true,
    });
    return { status: delivery.status, preview: message, delivery };
  }

  renderDailySummary(
    context: DailySummaryContext,
    settings: NotificationSettings,
    now = new Date(),
  ) {
    const snapshot = context.snapshot;
    const localDate = zonedClock(now, settings.dailySummary.timezone).date;
    const lines = [`Risky Investor daily P/L summary \u00b7 ${localDate}`];
    const metrics = settings.dailySummary.metrics;
    if (!snapshot) {
      lines.push("Portfolio snapshot: unavailable.");
    } else {
      if (metrics.actualPortfolioValue) {
        lines.push(`Actual portfolio value: ${money(snapshot.actualPortfolioValue)}.`);
      }
      if (metrics.modelPortfolioValue) {
        lines.push(`Model portfolio value: ${money(snapshot.modelPortfolioValue)}.`);
      }
      if (metrics.actualPL) {
        lines.push(`Actual daily P/L: ${money(snapshot.actualDailyPnl)}.`);
      }
      if (metrics.modelPL) {
        lines.push(`Model daily P/L: ${money(snapshot.modelDailyPnl)}.`);
      }
      if (metrics.realisedPL) {
        lines.push(`Realised P/L: ${money(snapshot.realisedPnl)}.`);
      }
      if (metrics.unrealisedPL) {
        lines.push(`Unrealised P/L: ${money(snapshot.unrealisedPnl)}.`);
      }
      if (metrics.contributionsWithdrawals) {
        lines.push(
          `Contributions: ${money(snapshot.contributions)} \u00b7 withdrawals: ${money(snapshot.withdrawals)}.`,
        );
      }
      if (metrics.drawdown) {
        lines.push(`Current drawdown: ${percent(snapshot.currentDrawdownPercent)}.`);
      }
      if (metrics.cashInvested) {
        lines.push(
          `Cash: ${money(snapshot.cashValue)} \u00b7 invested: ${money(snapshot.investedValue)}.`,
        );
      }
    }
    if (metrics.latestActionableSignal) {
      const event = context.latestActionableEvent;
      lines.push(
        event
          ? `Latest actionable signal: ${event.signalState} ${event.tradeTicker} \u00b7 ${event.reasonText}`
          : "Latest actionable signal: none.",
      );
    }
    if (metrics.scannerFreshness) {
      lines.push(
        `Scanner status: ${context.scanner.status}` +
          (context.scanner.lastSuccessfulScanAt
            ? ` \u00b7 last success ${context.scanner.lastSuccessfulScanAt}`
            : ""),
      );
    }
    lines.push("Private tracking only. No broker execution.");
    return { localDate, message: lines.join("\n") };
  }

  async runDailySummary(
    context: DailySummaryContext,
    options: {
      dryRun?: boolean;
      recordDryRun?: boolean;
      force?: boolean;
      now?: Date;
    } = {},
  ): Promise<DailySummaryResult> {
    const settings = await this.settings();
    const now = options.now ?? new Date();
    const rendered = this.renderDailySummary(context, settings, now);
    const snapshot = context.snapshot;
    const baseNotificationKey =
      `daily_summary:${rendered.localDate}:${settings.dailySummary.timezone}`;
    const payload = validateDiscordPayload(
      dailySummaryDiscordPayload({
        localDate: rendered.localDate,
        snapshot,
        latestActionableEvent: context.latestActionableEvent,
        scanner: context.scanner,
        settings,
      }),
    );

    const blockedReason = (() => {
      if (!options.force && !settings.dailySummary.enabled) {
        return "Daily summaries are disabled.";
      }
      if (!options.force && !settings.signalAlerts.dailySummary) {
        return "Daily-summary alerts are disabled.";
      }
      if (!snapshot) return "No canonical portfolio snapshot is available.";
      if (
        context.scanner.status !== "current" &&
        !settings.dailySummary.sendStaleSummaries
      ) {
        return "Scanner data is stale or unavailable.";
      }
      if (!options.force && isQuiet(settings, now)) {
        return "Quiet hours are active.";
      }
      const actualMove = Math.abs(snapshot.actualDailyPnl ?? 0);
      const modelMove = Math.abs(snapshot.modelDailyPnl ?? 0);
      const absoluteMove = Math.max(actualMove, modelMove);
      const base =
        snapshot.actualPortfolioValue ?? snapshot.modelPortfolioValue;
      const percentageMove =
        base && base > 0 ? (absoluteMove / Math.max(1, base - absoluteMove)) * 100 : 0;
      if (
        !options.force &&
        absoluteMove < settings.thresholds.minimumAbsoluteDailyPL &&
        percentageMove < settings.thresholds.minimumDailyPLPercent
      ) {
        return "Daily P/L movement is below the configured threshold.";
      }
      return null;
    })();

    if (options.dryRun) {
      let delivery: AlertDelivery | null = null;
      if (options.recordDryRun) {
        delivery = await this.recordFinal({
          notificationKey: `${baseNotificationKey}:dry-run:${randomUUID()}`,
          eventId: snapshot?.snapshotId ?? null,
          channel: "daily_summary",
          category: "daily_summary",
          status: "skipped",
          message: rendered.message,
          errorMessage: blockedReason ?? "Dry-run only; no provider contacted.",
          retryCount: 0,
        });
      }
      return {
        status: "skipped",
        preview: rendered.message,
        reason: blockedReason ?? "Dry-run only; no provider contacted.",
        delivery,
      };
    }

    if (blockedReason) {
      const delivery = await this.recordFinal({
        notificationKey: `${baseNotificationKey}:gated`,
        eventId: snapshot?.snapshotId ?? null,
        channel: "daily_summary",
        category: "daily_summary",
        status:
          blockedReason.includes("disabled") ||
          blockedReason.includes("not configured")
            ? "disabled"
            : "skipped",
        message: rendered.message,
        errorMessage: blockedReason,
        retryCount: 0,
      });
      return {
        status: delivery.status,
        preview: rendered.message,
        reason: blockedReason,
        delivery,
      };
    }
    if (
      !settings.migration.canonicalDashboardDiscordEnabled ||
      !settings.discord.enabled
    ) {
      const reason = !settings.migration.canonicalDashboardDiscordEnabled
        ? "Canonical dashboard Discord is disabled."
        : "Discord notifications are disabled.";
      const delivery = await this.recordFinal({
        notificationKey: `${baseNotificationKey}:disabled`,
        eventId: snapshot?.snapshotId ?? null,
        channel: "daily_summary",
        category: "daily_summary",
        status: "disabled",
        message: rendered.message,
        errorMessage: reason,
        retryCount: 0,
      });
      return {
        status: delivery.status,
        preview: rendered.message,
        reason,
        delivery,
      };
    }

    const targets = await this.destinations.deliveryTargets(
      settings.migration.legacyServerDiscordAlongsideManaged,
    );
    if (!targets.length) {
      const delivery = await this.recordFinal({
        notificationKey: `${baseNotificationKey}:unconfigured`,
        eventId: snapshot!.snapshotId,
        channel: "daily_summary",
        category: "daily_summary",
        status: "disabled",
        message: rendered.message,
        errorMessage: "Discord destination is not configured or enabled.",
        retryCount: 0,
      });
      return {
        status: delivery.status,
        preview: rendered.message,
        reason: delivery.errorMessage,
        delivery,
      };
    }
    const deliveries: AlertDelivery[] = [];
    for (const target of targets) {
      const notificationKey =
        `${baseNotificationKey}:${target.destinationId}`;
      const existing = await this.deliveries.findByKey(notificationKey);
      deliveries.push(
        existing && !options.force
          ? existing
          : await this.attempt({
          notificationKey,
          eventId: snapshot!.snapshotId,
          channel: "daily_summary",
          category: "daily_summary",
          message: rendered.message,
          payload,
          target,
          retryCount: existing?.retryCount ?? 0,
          existingDeliveryId: existing?.deliveryId,
            }),
      );
    }
    const delivery = deliveries[0] ?? null;
    if (deliveries.some((item) => item.status === "sent")) {
      settings.dailySummary.lastSentDate = rendered.localDate;
      await this.store.write("notification_settings.json", settings);
    }
    return {
      status: delivery?.status ?? "disabled",
      preview: rendered.message,
      reason: delivery?.errorMessage ?? null,
      delivery,
    };
  }

  async retryDelivery(deliveryId: string, confirmResend = false) {
    const delivery = await this.deliveries.get(deliveryId);
    if (!delivery) throw new Error("Delivery record not found.");
    const settings = await this.settings();
    if (
      !settings.migration.canonicalDashboardDiscordEnabled ||
      !settings.discord.enabled
    ) {
      throw new Error(
        "Canonical dashboard Discord must be enabled before retrying.",
      );
    }
    if (
      delivery.channel !== "discord" &&
      delivery.channel !== "daily_summary"
    ) {
      throw new Error("This delivery channel cannot be retried.");
    }
    if (delivery.status === "sent" && !confirmResend) {
      throw new Error("Explicit confirmation is required to re-send.");
    }
    if (delivery.status !== "failed" && delivery.status !== "sent") {
      throw new Error("Only failed or explicitly confirmed sent deliveries can retry.");
    }
    if (!delivery.destinationId) {
      throw new Error("Delivery destination is unavailable.");
    }
    const target = await this.destinations.target(delivery.destinationId);
    return this.attempt({
      notificationKey: delivery.notificationKey,
      eventId: delivery.eventId,
      channel: delivery.channel,
      category:
        delivery.category === "daily_summary"
          ? "daily_summary"
          : delivery.category === "test"
            ? "test"
            : "signal",
      message: delivery.message ?? "Risky Investor notification.",
      payload:
        delivery.discordPayload ??
        validateDiscordPayload(testDiscordPayload()),
      target,
      retryCount: delivery.retryCount + 1,
      existingDeliveryId: delivery.deliveryId,
    });
  }

  private async attempt(input: {
    notificationKey: string;
    eventId: string | null;
    channel: "discord" | "daily_summary";
    category: "signal" | "daily_summary" | "test";
    message: string;
    payload: DiscordWebhookPayload;
    target: DiscordDeliveryTarget;
    retryCount: number;
    existingDeliveryId?: string;
    tested?: boolean;
  }) {
    const attemptedAt = new Date().toISOString();
    let delivery = input.existingDeliveryId
      ? await this.deliveries.update(input.existingDeliveryId, {
          status: "pending",
          attemptedAt,
          deliveredAt: null,
          errorMessage: null,
          providerReference: null,
          retryCount: input.retryCount,
          message: input.message,
          discordPayload: input.payload,
        })
      : await this.deliveries.record({
          deliveryId: randomUUID(),
          eventId: input.eventId,
          notificationKey: input.notificationKey,
          destinationId: input.target.destinationId,
          destinationLabel: input.target.label,
          channel: input.channel,
          status: "pending",
          attemptedAt,
          deliveredAt: null,
          errorMessage: null,
          providerReference: null,
          retryCount: input.retryCount,
          category: input.category,
          message: input.message,
          discordPayload: input.payload,
        });
    if (!delivery) throw new Error("Delivery record not found.");
    try {
      const result = await this.destinations.transport.send(
        input.target.webhook,
        applyWebhookIdentity(input.payload, {
          displayName: input.target.displayName,
          avatarUrl: input.target.avatarUrl,
        }),
      );
      const deliveredAt = new Date().toISOString();
      delivery = (await this.deliveries.update(delivery.deliveryId, {
        status: "sent",
        deliveredAt,
        errorMessage: null,
        providerReference: result.providerReference,
      }))!;
      await this.destinations.recordResult(
        input.target.destinationId,
        "sent",
        { tested: input.tested, deliveredAt },
      );
    } catch (error) {
      delivery = (await this.deliveries.update(delivery.deliveryId, {
        status: "failed",
        deliveredAt: null,
        errorMessage: safeNotificationError(error),
        providerReference: null,
      }))!;
      await this.destinations.recordResult(
        input.target.destinationId,
        "failed",
        { tested: input.tested },
      );
    }
    return delivery;
  }

  private async recordFinal(input: {
    notificationKey: string;
    eventId: string | null;
    channel: "discord" | "daily_summary" | "weekly_summary";
    category: "signal" | "daily_summary" | "weekly_summary" | "test";
    status: AlertDeliveryStatus;
    message: string;
    errorMessage: string | null;
    retryCount: number;
  }) {
    const existing = await this.deliveries.findByKey(input.notificationKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.deliveries.record({
      deliveryId: randomUUID(),
      eventId: input.eventId,
      notificationKey: input.notificationKey,
      channel: input.channel,
      status: input.status,
      attemptedAt: now,
      deliveredAt: input.status === "sent" ? now : null,
      errorMessage: input.errorMessage,
      providerReference: null,
      retryCount: input.retryCount,
      category: input.category,
      message: input.message,
    });
  }
}

export class NotificationScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly contextFactory: () => Promise<DailySummaryContext>,
  ) {}

  start(intervalMilliseconds = 30_000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(() => undefined);
    }, intervalMilliseconds);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()) {
    const settings = await this.dispatcher.settings();
    if (
      !settings.dailySummary.enabled ||
      !settings.migration.canonicalDashboardDiscordEnabled
    ) {
      return null;
    }
    const clock = zonedClock(now, settings.dailySummary.timezone);
    if (clock.time !== settings.dailySummary.time) return null;
    return this.dispatcher.runDailySummary(await this.contextFactory(), {
      now,
    });
  }
}
