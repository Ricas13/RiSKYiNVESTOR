import type { NotificationSettings } from "./notifications.js";
import type {
  DailyPortfolioSnapshot,
  SignalEvent,
} from "./signalEvents.js";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  embeds: DiscordEmbed[];
}

export interface DiscordDailySummaryInput {
  localDate: string;
  snapshot: DailyPortfolioSnapshot | null;
  latestActionableEvent: SignalEvent | null;
  scanner: {
    status: "awaiting" | "current" | "stale" | "error";
    lastSuccessfulScanAt: string | null;
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
  settings: NotificationSettings;
}

export const discordColors = {
  gold: 0xf1c40f,
  green: 0x2ecc71,
  red: 0xe74c3c,
  blue: 0x3498db,
  amber: 0xf39c12,
} as const;

const footer = {
  text: "Private tracking only \u00b7 Verify manually before acting",
};

function compact(value: unknown, maximum = 900) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= maximum
    ? text || "Unavailable"
    : `${text.slice(0, maximum - 1)}\u2026`;
}

function safeScannerError(value: unknown) {
  return compact(value, 900)
    .replace(
      /https?:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\S+/gi,
      "[redacted webhook]",
    )
    .replace(/[A-Za-z]:\\[^\s]+|\/(?:opt|home|var|Users)\/[^\s]+/g, "[redacted path]")
    .replace(/\s+at\s+.+/g, "");
}

function field(name: string, value: unknown, inline = false) {
  return {
    name: compact(name, 256),
    value: compact(value, 1_024),
    inline,
  };
}

function money(value: number | null) {
  return value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 2,
      }).format(value);
}

function percent(value: number | null) {
  return value === null ? "Unavailable" : `${value.toFixed(2)}%`;
}

function signalColor(event: SignalEvent) {
  if (event.signalState === "actionable_entry") return discordColors.green;
  if (
    event.signalState === "actionable_exit" ||
    event.signalState === "scanner_error"
  ) {
    return discordColors.red;
  }
  if (event.signalState === "low_liquidity_warning") {
    return discordColors.amber;
  }
  return discordColors.blue;
}

function signalTitle(event: SignalEvent) {
  if (event.signalState === "actionable_entry") {
    return "Adaptive SuperTrend \u00b7 ACTIONABLE ENTRY";
  }
  if (event.signalState === "actionable_exit") {
    return "Adaptive SuperTrend \u00b7 ACTIONABLE EXIT";
  }
  if (event.signalState === "scanner_error") {
    return "\ud83d\udd34 Adaptive SuperTrend \u00b7 SCANNER ERROR";
  }
  if (event.signalState === "low_liquidity_warning") {
    return "\u26a0\ufe0f Adaptive SuperTrend \u00b7 LOW LIQUIDITY";
  }
  return "\ud83d\udd35 Adaptive SuperTrend \u00b7 WATCHLIST STATUS";
}

export function signalDiscordPayload(event: SignalEvent): DiscordWebhookPayload {
  const fields = [
    field(
      "Instrument",
      `${event.underlyingTicker} \u2192 ${event.tradeTicker}`,
    ),
    field("Reason", event.reasonText),
    field(
      "Trend",
      `${event.previousTrend} \u2192 ${event.currentTrend}`,
      true,
    ),
    field("Risk tier", event.riskTier, true),
    field("Eligibility", event.eligibility, true),
    field(
      "Allocation",
      `${event.allocationPercent}% \u00b7 ${event.allocationStatus}`,
      true,
    ),
    field("Occurred", event.occurredAt, true),
    field("Event ID", event.eventId, true),
  ];
  if (event.signalState === "actionable_exit") {
    fields.splice(2, 0, field("Exit reason", event.reasonText));
  }
  if (event.signalState === "scanner_error") {
    fields.splice(
      1,
      fields.length,
      field("Safe error", safeScannerError(event.reasonText)),
      field("Affected source", event.source, true),
      field("Scan timestamp", event.occurredAt, true),
      field("Event ID", event.eventId, true),
    );
  }
  if (event.signalState === "low_liquidity_warning") {
    fields.splice(
      1,
      fields.length,
      field("Liquidity context", event.reasonText),
      field("Eligibility", event.eligibility, true),
      field("Risk tier", event.riskTier, true),
      field("Why it matters", "Check the executable spread and use a limit order."),
      field("Event ID", event.eventId, true),
    );
  }
  return {
    embeds: [
      {
        title: signalTitle(event),
        color: signalColor(event),
        fields,
        footer,
        timestamp: event.occurredAt,
      },
    ],
  };
}

export function testDiscordPayload(): DiscordWebhookPayload {
  return {
    embeds: [
      {
        title: "\u2705 Discord delivery test \u2014 no trading action",
        description:
          "This harmless message confirms that the selected Risky Investor destination can receive structured notifications.",
        color: discordColors.blue,
        footer,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function dailySummaryDiscordPayload(
  input: DiscordDailySummaryInput,
): DiscordWebhookPayload {
  const { scanner, snapshot, settings } = input;
  const watchlist = scanner.watchlist ?? [];
  const green = watchlist
    .filter((item) => item.currentTrend?.toLowerCase() === "green")
    .map((item) => item.tradeTicker ?? item.underlyingTicker)
    .filter(Boolean);
  const red = watchlist
    .filter((item) => item.currentTrend?.toLowerCase() === "red")
    .map((item) => item.tradeTicker ?? item.underlyingTicker)
    .filter(Boolean);
  const embeds: DiscordEmbed[] = [
    {
      title: "\ud83d\udcca Adaptive SuperTrend Daily Summary",
      description: compact(
        scanner.summary ??
          `Scanner status: ${scanner.status}. Review the dashboard before acting.`,
      ),
      color: discordColors.gold,
      fields: [
        field("Date", input.localDate, true),
        field("Scanner", scanner.status.toUpperCase(), true),
        field("Imported signals", scanner.importedEvents ?? 0, true),
        field("Warnings", scanner.warningCount ?? 0, true),
        field("Errors", scanner.errorCount ?? 0, true),
        field(
          "Action",
          input.latestActionableEvent
            ? `${input.latestActionableEvent.signalState} \u00b7 ${input.latestActionableEvent.tradeTicker}`
            : "\u2705 No new actionable signal",
        ),
      ],
      footer,
      timestamp:
        scanner.lastSuccessfulScanAt ?? new Date().toISOString(),
    },
    {
      title: "\ud83d\udd35 Current Watchlist Status",
      color: discordColors.blue,
      fields: [
        field("\ud83d\udfe2 Green", green.length ? green.join(", ") : "None"),
        field("\ud83d\udd34 Red", red.length ? red.join(", ") : "None"),
      ],
      footer,
    },
  ];

  if (snapshot) {
    const metrics = settings.dailySummary.metrics;
    const positionFields: DiscordEmbedField[] = [];
    if (metrics.actualPortfolioValue) {
      positionFields.push(
        field("Actual portfolio", money(snapshot.actualPortfolioValue), true),
      );
    }
    if (metrics.modelPortfolioValue) {
      positionFields.push(
        field("Model portfolio", money(snapshot.modelPortfolioValue), true),
      );
    }
    if (metrics.actualPL) {
      positionFields.push(
        field("Actual daily P/L", money(snapshot.actualDailyPnl), true),
      );
    }
    if (metrics.modelPL) {
      positionFields.push(
        field("Model daily P/L", money(snapshot.modelDailyPnl), true),
      );
    }
    if (metrics.realisedPL) {
      positionFields.push(
        field("Realised P/L", money(snapshot.realisedPnl), true),
      );
    }
    if (metrics.unrealisedPL) {
      positionFields.push(
        field("Unrealised P/L", money(snapshot.unrealisedPnl), true),
      );
    }
    if (metrics.drawdown) {
      positionFields.push(
        field("Drawdown", percent(snapshot.currentDrawdownPercent), true),
      );
    }
    if (metrics.cashInvested) {
      positionFields.push(
        field(
          "Cash / invested",
          `${money(snapshot.cashValue)} / ${money(snapshot.investedValue)}`,
        ),
      );
    }
    embeds.push({
      title: "\ud83d\udfe2 Position and P/L Snapshot",
      color: discordColors.green,
      fields: positionFields.slice(0, 25),
      footer,
      timestamp: snapshot.timestamp,
    });
  }
  return { embeds };
}

export function applyWebhookIdentity(
  payload: DiscordWebhookPayload,
  identity: { displayName?: string | null; avatarUrl?: string | null },
) {
  return {
    ...payload,
    ...(identity.displayName ? { username: compact(identity.displayName, 80) } : {}),
    ...(identity.avatarUrl ? { avatar_url: identity.avatarUrl } : {}),
  };
}

export function validateDiscordPayload(payload: DiscordWebhookPayload) {
  if (!payload.embeds.length || payload.embeds.length > 10) {
    throw new Error("Discord payload must contain between 1 and 10 embeds.");
  }
  let total = 0;
  for (const embed of payload.embeds) {
    if (embed.title.length > 256) throw new Error("Discord title is too long.");
    if ((embed.description?.length ?? 0) > 4_096) {
      throw new Error("Discord description is too long.");
    }
    total += embed.title.length + (embed.description?.length ?? 0);
    if ((embed.fields?.length ?? 0) > 25) {
      throw new Error("Discord embed has too many fields.");
    }
    for (const item of embed.fields ?? []) {
      if (item.name.length > 256 || item.value.length > 1_024) {
        throw new Error("Discord embed field is too long.");
      }
      total += item.name.length + item.value.length;
    }
  }
  if (total > 6_000) {
    throw new Error("Discord payload is too large.");
  }
  return payload;
}
