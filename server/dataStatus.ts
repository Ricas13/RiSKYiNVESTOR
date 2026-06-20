import { randomUUID } from "node:crypto";
import {
  awaitingScannerState,
  disabledNotificationSettings,
  emptyModelPerformance,
  emptyModelSummary,
  emptySiteConfig,
} from "./runtimeData.js";
import { JsonStore } from "./store.js";

export type DataClassification =
  | "Demo"
  | "Mixed"
  | "Live"
  | "Empty"
  | "Unknown — requires review";

export interface DataAreaStatus {
  id: string;
  label: string;
  classification: DataClassification;
  recordCount: number;
  demoCount: number;
  liveCount: number;
  unknownCount: number;
  explanation: string;
  datasets: string[];
}

export interface DataStatusReport {
  generatedAt: string;
  hasDemoData: boolean;
  warning: string | null;
  areas: DataAreaStatus[];
  totals: {
    records: number;
    demo: number;
    live: number;
    unknown: number;
  };
}

interface Counts {
  demo: number;
  live: number;
  unknown: number;
}

interface DatasetPlan extends Counts {
  path: string;
  nextValue?: unknown;
}

interface AreaDefinition {
  id: string;
  label: string;
  explanation: string;
  datasets: string[];
}

const areaDefinitions: AreaDefinition[] = [
  {
    id: "manual-trades",
    label: "Manual trades",
    explanation: "Owner-entered trade journal records and derived open/closed views.",
    datasets: ["manual_trades.json"],
  },
  {
    id: "portfolio-snapshots",
    label: "Portfolio snapshots",
    explanation: "Manual wealth history and canonical scanner portfolio snapshots.",
    datasets: ["wealth_snapshots.json", "daily_portfolio_snapshots.json"],
  },
  {
    id: "cash-flows",
    label: "Cash flows",
    explanation: "Deposits and withdrawals used in actual portfolio calculations.",
    datasets: ["cash_flows.json"],
  },
  {
    id: "signal-history",
    label: "Signal history",
    explanation: "Canonical scanner events plus retained model signal history.",
    datasets: [
      "signal_events.json",
      "signal_decisions.json",
      "model/signals_today.json",
      "model/signals_archive.json",
    ],
  },
  {
    id: "alerts-deliveries",
    label: "Alerts/deliveries",
    explanation: "Dashboard alerts and notification delivery audit records.",
    datasets: ["alerts.json", "alert_deliveries.json"],
  },
  {
    id: "model-performance",
    label: "Model performance",
    explanation: "Imported model summary and performance series.",
    datasets: ["model/latest_summary.json", "model/performance.json"],
  },
  {
    id: "model-trades",
    label: "Open/closed model trades",
    explanation: "Scanner-managed model positions and closed-trade history.",
    datasets: ["model/open_trades.json", "model/closed_trades.json"],
  },
  {
    id: "watchlist-status",
    label: "Watchlist/status",
    explanation: "Scanner watchlist state and import freshness metadata.",
    datasets: ["model/watchlist_status.json", "scanner_import_state.json"],
  },
  {
    id: "strategy-definitions",
    label: "Strategy definitions",
    explanation: "Owner strategy registry and scanner strategy/backtest configuration.",
    datasets: ["strategies.json", "model/site_config.json"],
  },
  {
    id: "account-settings",
    label: "Account/settings",
    explanation: "Private account metadata, risk settings, and notification preferences.",
    datasets: ["account.json", "settings.json", "notification_settings.json"],
  },
];

const knownDemoIds: Record<string, Set<string>> = {
  "model/signals_today.json": new Set([
    "sig-20260617-smh",
    "sig-20260617-silver",
    "sig-20260617-nvda-tp",
  ]),
  "model/signals_archive.json": new Set([
    "sig-20260115-ark",
    "sig-20260220-meta",
    "sig-20260210-qqq",
    "sig-20260305-gold",
    "sig-20260617-smh",
    "sig-20260617-silver",
    "sig-20260617-nvda-tp",
  ]),
  "model/open_trades.json": new Set([
    "open-qqq3",
    "open-3usl",
    "open-3gld",
    "open-3nvd",
    "open-3msf",
    "open-3ark",
  ]),
  "model/closed_trades.json": new Set(
    Array.from({ length: 8 }, (_, index) => `closed-${String(index + 1).padStart(3, "0")}`),
  ),
  "model/watchlist_status.json": new Set([
    "nasdaq-100",
    "sp-500",
    "magnificent-7",
    "total-world",
    "gold",
    "silver",
    "semiconductors",
    "nvidia",
    "alphabet",
    "netflix",
    "apple",
    "amazon",
    "microsoft",
    "meta",
    "tesla",
    "coinbase",
    "arm",
    "ark-innovation",
    "shell",
  ]),
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function explicitDemoRecord(value: unknown) {
  const record = asRecord(value);
  if (!record) return false;
  if (
    record.isExample === true ||
    record.isDemo === true ||
    record.demo === true ||
    record.dataStatus === "demo"
  ) {
    return true;
  }
  const id = typeof record.id === "string" ? record.id.toLowerCase() : "";
  const notice =
    typeof record.notice === "string" ? record.notice.toLowerCase() : "";
  return id.startsWith("example-") || /\b(fake|demo|example)\b/.test(notice);
}

function arrayValue(value: unknown, key?: string) {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  return key && record && Array.isArray(record[key])
    ? (record[key] as unknown[])
    : null;
}

function wrapperPlan(
  path: string,
  raw: unknown,
  key: string,
  options: {
    emptyNotice: string;
    unmarked: "live" | "unknown";
    emptyValue?: unknown;
  },
): DatasetPlan {
  const record = asRecord(raw);
  const values = arrayValue(raw, key);
  if (!record || !values) {
    return { path, demo: 0, live: 0, unknown: 1 };
  }
  if (record.isExample === true) {
    return {
      path,
      demo: Math.max(1, values.length),
      live: 0,
      unknown: 0,
      nextValue:
        options.emptyValue ?? {
          ...record,
          isExample: false,
          notice: options.emptyNotice,
          [key]: [],
        },
    };
  }
  const demo = values.filter(explicitDemoRecord);
  const retained = values.filter((value) => !explicitDemoRecord(value));
  return {
    path,
    demo: demo.length,
    live: options.unmarked === "live" ? retained.length : 0,
    unknown: options.unmarked === "unknown" ? retained.length : 0,
    nextValue: demo.length
      ? {
          ...record,
          isExample: false,
          notice: options.emptyNotice,
          [key]: retained,
        }
      : undefined,
  };
}

function flexibleArrayPlan(
  path: string,
  raw: unknown,
  key: string,
  unmarked: "live" | "unknown",
): DatasetPlan {
  const values = arrayValue(raw, key);
  const wrapper = asRecord(raw);
  if (!values) return { path, demo: 0, live: 0, unknown: 1 };
  if (wrapper?.isExample === true) {
    const empty = Array.isArray(raw)
      ? []
      : { ...wrapper, isExample: false, [key]: [] };
    return {
      path,
      demo: Math.max(1, values.length),
      live: 0,
      unknown: 0,
      nextValue: empty,
    };
  }
  const knownIds = knownDemoIds[path] ?? new Set<string>();
  const isDemo = (value: unknown) => {
    const record = asRecord(value);
    const id =
      typeof record?.id === "string"
        ? record.id
        : typeof record?.eventId === "string"
          ? record.eventId
          : "";
    return explicitDemoRecord(value) || knownIds.has(id);
  };
  const demo = values.filter(isDemo);
  const retained = values.filter((value) => !isDemo(value));
  const nextValue = demo.length
    ? Array.isArray(raw)
      ? retained
      : { ...wrapper, isExample: false, [key]: retained }
    : undefined;
  return {
    path,
    demo: demo.length,
    live: unmarked === "live" ? retained.length : 0,
    unknown: unmarked === "unknown" ? retained.length : 0,
    nextValue,
  };
}

function singletonPlan(
  path: string,
  raw: unknown,
  isKnownDemo: (value: Record<string, unknown>) => boolean,
  emptyValue: unknown,
  unmarked: "live" | "unknown" = "unknown",
  isEmpty: (value: Record<string, unknown>) => boolean = () => false,
): DatasetPlan {
  const record = asRecord(raw);
  if (!record) return { path, demo: 0, live: 0, unknown: 1 };
  if (record.isExample === true || isKnownDemo(record)) {
    return {
      path,
      demo: 1,
      live: 0,
      unknown: 0,
      nextValue: emptyValue,
    };
  }
  if (isEmpty(record)) {
    return { path, demo: 0, live: 0, unknown: 0 };
  }
  return {
    path,
    demo: 0,
    live: unmarked === "live" ? 1 : 0,
    unknown: unmarked === "unknown" ? 1 : 0,
  };
}

function configPlan(
  path: string,
  raw: unknown,
  emptyValue: unknown,
): DatasetPlan {
  const record = asRecord(raw);
  if (!record) return { path, demo: 0, live: 0, unknown: 1 };
  if (record.isExample === true) {
    return { path, demo: 1, live: 0, unknown: 0, nextValue: emptyValue };
  }
  return { path, demo: 0, live: 1, unknown: 0 };
}

function classification(counts: Counts): DataClassification {
  if (counts.demo > 0) {
    return counts.live > 0 || counts.unknown > 0 ? "Mixed" : "Demo";
  }
  if (counts.unknown > 0) return "Unknown — requires review";
  if (counts.live > 0) return "Live";
  return "Empty";
}

function explanation(definition: AreaDefinition, counts: Counts) {
  const status = classification(counts);
  if (status === "Demo") {
    return `${definition.explanation} All detected content is explicitly marked or exactly fingerprinted as shipped demo data.`;
  }
  if (status === "Mixed") {
    return `${definition.explanation} Demo content can be removed; live or unmarked records will be preserved.`;
  }
  if (status === "Unknown — requires review") {
    return `${definition.explanation} Unmarked historical content is preserved and requires manual review.`;
  }
  if (status === "Live") {
    return `${definition.explanation} Content is unmarked as demo and belongs to an owner-entered or canonical live dataset.`;
  }
  return `${definition.explanation} No records are present.`;
}

async function buildPlans(store: JsonStore, account: {
  username: string;
  role: "owner" | "user" | "admin";
}) {
  const paths = [
    "manual_trades.json",
    "open_positions.json",
    "closed_trades.json",
    "wealth_snapshots.json",
    "cash_flows.json",
    "account.json",
    "strategies.json",
    "settings.json",
    "signal_events.json",
    "daily_portfolio_snapshots.json",
    "audit_log.json",
    "scanner_import_state.json",
    "notification_settings.json",
    "alert_deliveries.json",
    "signal_decisions.json",
    "alerts.json",
    "model/latest_summary.json",
    "model/watchlist_status.json",
    "model/signals_today.json",
    "model/signals_archive.json",
    "model/open_trades.json",
    "model/closed_trades.json",
    "model/performance.json",
    "model/site_config.json",
  ] as const;
  const values = await Promise.all(paths.map((path) => store.read<unknown>(path)));
  const data = Object.fromEntries(paths.map((path, index) => [path, values[index]]));
  const audit = data["audit_log.json"];
  if (!Array.isArray(audit)) {
    throw new Error('Invalid cleanup audit file "audit_log.json". No files were modified.');
  }

  const plans: DatasetPlan[] = [
    wrapperPlan("manual_trades.json", data["manual_trades.json"], "trades", {
      emptyNotice: "No manual trades recorded.",
      unmarked: "live",
    }),
    wrapperPlan(
      "wealth_snapshots.json",
      data["wealth_snapshots.json"],
      "snapshots",
      {
        emptyNotice: "No wealth snapshots recorded.",
        unmarked: "live",
      },
    ),
    flexibleArrayPlan(
      "daily_portfolio_snapshots.json",
      data["daily_portfolio_snapshots.json"],
      "snapshots",
      "live",
    ),
    wrapperPlan("cash_flows.json", data["cash_flows.json"], "cashFlows", {
      emptyNotice: "No cash flows recorded.",
      unmarked: "live",
    }),
    flexibleArrayPlan(
      "signal_events.json",
      data["signal_events.json"],
      "events",
      "live",
    ),
    wrapperPlan(
      "signal_decisions.json",
      data["signal_decisions.json"],
      "decisions",
      {
        emptyNotice: "No signal decisions recorded.",
        unmarked: "live",
      },
    ),
    flexibleArrayPlan(
      "model/signals_today.json",
      data["model/signals_today.json"],
      "signals",
      "unknown",
    ),
    flexibleArrayPlan(
      "model/signals_archive.json",
      data["model/signals_archive.json"],
      "signals",
      "unknown",
    ),
    wrapperPlan("alerts.json", data["alerts.json"], "alerts", {
      emptyNotice: "No alerts recorded.",
      unmarked: "live",
    }),
    flexibleArrayPlan(
      "alert_deliveries.json",
      data["alert_deliveries.json"],
      "deliveries",
      "live",
    ),
    singletonPlan(
      "model/latest_summary.json",
      data["model/latest_summary.json"],
      (value) =>
        value.lastScan === "2026-06-17T21:35:00Z" &&
        value.realisedModelPL === 148.6 &&
        value.openModelTrades === 6,
      emptyModelSummary,
      "unknown",
      (value) =>
        value.dataStatus === "Awaiting scanner data" &&
        value.openModelTrades === 0 &&
        value.realisedModelPL === 0,
    ),
    singletonPlan(
      "model/performance.json",
      data["model/performance.json"],
      (value) =>
        value.realisedModelPL === 148.6 &&
        value.closedTrades === 24 &&
        value.fixedStakeEquivalent === 2486,
      emptyModelPerformance,
      "unknown",
      (value) =>
        value.closedTrades === 0 &&
        Array.isArray(value.realisedSeries) &&
        value.realisedSeries.length === 0 &&
        Array.isArray(value.openTradePL) &&
        value.openTradePL.length === 0,
    ),
    flexibleArrayPlan(
      "model/open_trades.json",
      data["model/open_trades.json"],
      "trades",
      "unknown",
    ),
    flexibleArrayPlan(
      "model/closed_trades.json",
      data["model/closed_trades.json"],
      "trades",
      "unknown",
    ),
    flexibleArrayPlan(
      "model/watchlist_status.json",
      data["model/watchlist_status.json"],
      "watchlist",
      "unknown",
    ),
    singletonPlan(
      "scanner_import_state.json",
      data["scanner_import_state.json"],
      () => false,
      awaitingScannerState,
      "live",
      (value) =>
        value.status === "awaiting" &&
        Array.isArray(value.watchlist) &&
        value.watchlist.length === 0,
    ),
    wrapperPlan("strategies.json", data["strategies.json"], "strategies", {
      emptyNotice: "No strategies configured.",
      unmarked: "live",
    }),
    singletonPlan(
      "model/site_config.json",
      data["model/site_config.json"],
      (value) => {
        const backtests = asRecord(value.backtests);
        const baseline = asRecord(backtests?.baseline);
        return (
          baseline?.startingCapital === 20000 &&
          baseline.finalEquity === 216897 &&
          baseline.totalReturn === 984.48
        );
      },
      emptySiteConfig,
      "unknown",
      (value) => {
        const backtests = asRecord(value.backtests);
        const baseline = asRecord(backtests?.baseline);
        return (
          baseline?.startingCapital === 0 &&
          baseline.finalEquity === 0 &&
          Array.isArray(backtests?.secondaryTests) &&
          backtests.secondaryTests.length === 0
        );
      },
    ),
    configPlan("account.json", data["account.json"], {
      isExample: false,
      account: {
        id: "owner-account",
        username: account.username,
        displayName: account.username,
        role: account.role,
        currency: "GBP",
        createdAt: new Date().toISOString(),
      },
    }),
    configPlan("settings.json", data["settings.json"], {
      isExample: false,
      assumedMissedStake: 0,
      riskLimits: {
        maxTickerPct: 100,
        maxTechnologyPct: 100,
        maxSpeculativePct: 100,
        maxLeveraged3xPct: 100,
        minimumCashPct: 0,
        elevatedDrawdownPct: 100,
      },
    }),
    configPlan(
      "notification_settings.json",
      data["notification_settings.json"],
      disabledNotificationSettings,
    ),
  ];

  return { plans, audit };
}

export async function buildDataStatusReport(
  store: JsonStore,
  account: { username: string; role: "owner" | "user" | "admin" },
): Promise<DataStatusReport> {
  const { plans } = await buildPlans(store, account);
  const areas = areaDefinitions.map((definition): DataAreaStatus => {
    const areaPlans = plans.filter((plan) =>
      definition.datasets.includes(plan.path),
    );
    const counts = areaPlans.reduce<Counts>(
      (sum, plan) => ({
        demo: sum.demo + plan.demo,
        live: sum.live + plan.live,
        unknown: sum.unknown + plan.unknown,
      }),
      { demo: 0, live: 0, unknown: 0 },
    );
    return {
      id: definition.id,
      label: definition.label,
      classification: classification(counts),
      recordCount: counts.demo + counts.live + counts.unknown,
      demoCount: counts.demo,
      liveCount: counts.live,
      unknownCount: counts.unknown,
      explanation: explanation(definition, counts),
      datasets: definition.datasets,
    };
  });
  const totals = areas.reduce(
    (sum, area) => ({
      records: sum.records + area.recordCount,
      demo: sum.demo + area.demoCount,
      live: sum.live + area.liveCount,
      unknown: sum.unknown + area.unknownCount,
    }),
    { records: 0, demo: 0, live: 0, unknown: 0 },
  );
  return {
    generatedAt: new Date().toISOString(),
    hasDemoData: totals.demo > 0,
    warning:
      totals.demo > 0
        ? "Demo data present — not live portfolio or scanner data"
        : null,
    areas,
    totals,
  };
}

export async function cleanupDemoData(
  store: JsonStore,
  account: {
    username: string;
    role: "owner" | "user" | "admin";
  },
) {
  const { plans, audit } = await buildPlans(store, account);
  const changed = plans.filter((plan) => plan.demo > 0 && plan.nextValue !== undefined);
  const manualPlan = changed.find((plan) => plan.path === "manual_trades.json");
  const manualFile = asRecord(manualPlan?.nextValue);
  const trades = Array.isArray(manualFile?.trades) ? manualFile.trades : null;
  if (trades) {
    changed.push(
      {
        path: "open_positions.json",
        demo: 0,
        live: 0,
        unknown: 0,
        nextValue: {
          isExample: false,
          generatedAt: new Date().toISOString(),
          positions: trades.filter((value) => {
            const trade = asRecord(value);
            const exits = Array.isArray(trade?.exits) ? trade.exits : [];
            const sold = exits.reduce((sum, exit) => {
              const record = asRecord(exit);
              return sum + Number(record?.quantitySold ?? 0);
            }, 0);
            return Number(trade?.quantity ?? 0) - sold > 0.000001;
          }),
        },
      },
      {
        path: "closed_trades.json",
        demo: 0,
        live: 0,
        unknown: 0,
        nextValue: {
          isExample: false,
          generatedAt: new Date().toISOString(),
          trades: trades.filter((value) => {
            const trade = asRecord(value);
            const exits = Array.isArray(trade?.exits) ? trade.exits : [];
            const sold = exits.reduce((sum, exit) => {
              const record = asRecord(exit);
              return sum + Number(record?.quantitySold ?? 0);
            }, 0);
            return Number(trade?.quantity ?? 0) - sold <= 0.000001;
          }),
        },
      },
    );
  }

  const affected = changed
    .filter((plan) => plan.demo > 0)
    .map((plan) => ({ dataset: plan.path, removed: plan.demo }));
  const auditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actor: account.username,
    action: "demo-data-cleanup",
    affectedDatasets: affected,
    totalRemoved: affected.reduce((sum, item) => sum + item.removed, 0),
  };
  if (affected.length === 0) {
    return {
      cleaned: false,
      affectedDatasets: [],
      totalRemoved: 0,
      auditId: null,
    };
  }
  await store.writeBatch([
    ...changed.map((plan) => ({
      relativePath: plan.path,
      value: plan.nextValue,
    })),
    {
      relativePath: "audit_log.json",
      value: [...audit, auditEntry],
    },
  ]);
  return {
    cleaned: true,
    affectedDatasets: affected,
    totalRemoved: auditEntry.totalRemoved,
    auditId: auditEntry.id,
  };
}
