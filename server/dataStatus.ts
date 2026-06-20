import { createHash, randomUUID } from "node:crypto";
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
  | "Unknown \u2014 requires review";

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

// Each hash covers the canonical JSON for one complete shipped fixture record.
// Matching IDs or any partial subset of fields never qualify for removal.
const strictShippedFixtureFingerprints: Record<string, Set<string>> = {
  "model/latest_summary.json": new Set([
    "92c6fd3924d9a374852e9c367fe4ee70e94034c621f9d7b944e46d462aa8249a",
  ]),
  "model/performance.json": new Set([
    "af09c9728e143975c40318ccdfc1cf5110d832ba0a7020924f7309421bb3dee9",
  ]),
  "model/site_config.json": new Set([
    "e029ae13dfae5718a55bc9ad5c799162590fd0ab093ccbedec8310491d50e914",
  ]),
  "model/signals_today.json": new Set([
    "66f0cae17fbf8900d61c7d1e78a0f053d84383f28784a333afd9088ddc5104bb",
    "929bfe88bb287a989aec9415f6421af5c9cd5ec9da6e33b08592278dab564ed5",
    "1aca12602dd7ea2a3e2653e73fa6e79c5f7203958eca5f75cf4745f292438482",
  ]),
  "model/signals_archive.json": new Set([
    "b86292d722fd5ba529173885333a8921ded42083445d0af3f7f768f89b52a477",
    "3713790bfa1e5eb771a96a797db9f2b6773a45d4a9943dad91b5d346e03146f6",
    "b3d9d58ef8ebc60f684ed6c73e2d75802596cc10da16e7df4dfc4c7e0f8730c0",
    "a9e3552887498cbdcab4fd0d01100b95065afdfc073286c20b56737d5543446b",
    "f9a26b76c70c242039e75d1b95fdf0286dfb1f5d950a45746f51bd8dce7a8061",
    "8da97298916db8762226e40cbb3e4cdb20a658dbc3b027be1668e6792aa0dd5e",
    "45fe9dbb310a9eae9c5bae187dd4a57bd31c99afb097efc9b49adabb4a643ca9",
  ]),
  "model/open_trades.json": new Set([
    "b30390d844a122e1f99db9bf1160a10f0a3094963c0e88e92489eb7a904f8899",
    "f2455a23db10d6d51a84e4b78420c882ceb77e1c62e35dd12dfc8def19bdd8e3",
    "f0b4ef22e92eda2ec8bd1934d5554c32d6ef63053e3c183ae7710d7611d9e4f4",
    "b5a9784e22753beead9196530289017a544a77497451edbec88301eb3b5f1673",
    "5b0a6b522a7556ae49fdee700fd2a53ac9cde1e7ea1049eab68ab69faf2b6c0e",
    "a48193cabb05df5f2f9c2ccd26527075127483b9bec1cd3bcfb8016947f28195",
  ]),
  "model/closed_trades.json": new Set([
    "66638c18cdd143d0358cc8a50fe2e538d38d3de713b8875e014e978bda6c36eb",
    "7add9d72b13bd61be41c2f9e92c5ccddfa24580165503b13f5398519ce6e2809",
    "0160e8d7960d410f6691dce418941d37c091a3b244d473484c14ee2e25894ebc",
    "fbeabab33979f2a425ddb1282baffa96901dcd6b904e035daa0461fcdbc0d3cf",
    "bbd0480adedcd57be6ed3c3a8d7a59873748b86491601b446835c1d6b0032a35",
    "3bde7bb25df9fcb8a42341be53926a4819e37a43d6bf6b9ed50696d2643d1c1f",
    "85b3b45baa9b150c2ccd88105c5f9fe1c8da14f559788e7d15c9e7e7a221ce74",
    "0928f1db13aed4e83ed31d8d36cdcf21046b06fd1b2eac0b7520e81d6719cdbd",
  ]),
  "model/watchlist_status.json": new Set([
    "277b9cb14ba967abf769b7be30a30ddd139c600ab946095e6ec2f7251f409491",
    "7cbcbe7cd46e36622e8f9f13d561cb7ec7bf1f613126f14579d9c8ce90715861",
    "d13eae3526a9e98e5d2712630a28ca20554a83e700092ff2b7c20ed7fe5821fa",
    "d5c18ce7d0af62a90f2465e7e4b28bed0de53703d259e4b0e03b43edf0a2f0fa",
    "d83a21220bd2daec317adc47b61efa87f6c15b826233a45227a4a1fb370da743",
    "46173dcda24b0c01805ce76f6c8f393a70d43dc36d92e5445abf0ccb1d19803e",
    "779e6d9fe72f91544e8ddc43c1f1a2a9946162c5305c6fec65e66b4016cb23d1",
    "9e6a20fc0528be7aef6806ecbee0737c23350e58adb1742043872b02928d1ea0",
    "4ac91b8d2b131d5934616ade085dc24a3cdb2e210883b5f700b8e79ae5b235d1",
    "3494bf7b1ff1a73c02d89ddc78b4505292d009014faa3a394d0977c5bc12fc54",
    "244e90325775ba8cf6a979c27abe2ccac1a7d34a9dcfda435782688ce33e8aca",
    "0d28784b410d2cd616443f77d5ddb1914009c8989b83aa83f91ff40883574709",
    "8d52416a5bf5396f38f3656c99835c8153350518cafbc926c05e85591a232bb4",
    "25bfed47b651f82596ad0cf454e9150a5c6fb79b4ad58dc57d543236915f25f5",
    "72b0d07d2b20a6c75c49a64ed137ba1f270c550d1d396036d2bd77ffd7cbda9c",
    "a362e6802bd8d1841b3a04320b271d4d2b77e2678b5d5bde614520d4ad356006",
    "ea4454fb02c6300329b96c091194207b66a1168e349c9015b03f921dfed541e6",
    "8fbc5354bbc9ff9eab34c8de565c0772d38303b7b4450e1ff77ab8d3f5807fd4",
    "cfa05675160f51e37f7f24861672914605add83df95b66661b77bee60f58dab1",
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
  return (
    record.isExample === true ||
    record.isDemo === true ||
    record.demo === true ||
    (typeof record.dataStatus === "string" &&
      record.dataStatus.toLowerCase() === "demo")
  );
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function isStrictShippedFixtureRecord(path: string, value: unknown) {
  const fingerprints = strictShippedFixtureFingerprints[path];
  if (!fingerprints) return false;
  const fingerprint = createHash("sha256")
    .update(stableJson(value))
    .digest("hex");
  return fingerprints.has(fingerprint);
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
  const isDemo = (value: unknown) =>
    explicitDemoRecord(value) ||
    isStrictShippedFixtureRecord(path, value);
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
  emptyValue: unknown,
  unmarked: "live" | "unknown" = "unknown",
  isEmpty: (value: Record<string, unknown>) => boolean = () => false,
): DatasetPlan {
  const record = asRecord(raw);
  if (!record) return { path, demo: 0, live: 0, unknown: 1 };
  if (
    explicitDemoRecord(record) ||
    isStrictShippedFixtureRecord(path, record)
  ) {
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
  if (counts.unknown > 0) return "Unknown \u2014 requires review";
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
  if (status === "Unknown \u2014 requires review") {
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
        ? "Demo data present \u2014 not live portfolio or scanner data"
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
