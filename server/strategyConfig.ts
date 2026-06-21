import path from "node:path";
import { isIP } from "node:net";
import { JsonStore } from "./store.js";

export type StrategyId = "daily-supertrend" | "nasdaq-sma200-3x";
export type StrategyEventType =
  | "entry"
  | "exit"
  | "lowLiquidity"
  | "stateUpdate"
  | "dailySummary"
  | "weeklySummary"
  | "scannerError";

export type TickerCatalogueCategory =
  | "Nasdaq reference"
  | "UK leveraged Nasdaq"
  | "UK broad equity ETF"
  | "UK bond/cash-like/risk-off"
  | "Other watchlist";

export interface TickerCatalogueEntry {
  entryId: string;
  label: string;
  symbol: string;
  marketDataSymbol: string;
  category: TickerCatalogueCategory;
  notes: string;
  enabled: boolean;
}

export interface StrategyConfigurationPreset {
  presetId: string;
  strategy: "nasdaqSma200" | "dailySuperTrend";
  name: string;
  description: string;
  warning: string;
  configuration: StrategyConfiguration;
}

export interface StrategyConfigurationResources {
  presets: StrategyConfigurationPreset[];
  tickerCatalogue: TickerCatalogueEntry[];
}

export interface StrategyConfiguration {
  version: 1;
  marketData: {
    provider: "stooq_csv" | "url_template_csv";
    urlTemplate: string;
    timeoutSeconds: number;
    maximumRetries: number;
  };
  strategies: {
    dailySuperTrend: {
      enabled: boolean;
      timeframe: string;
      referenceTimeframe: string;
      atrLength: number;
      atrPeriod: number;
      multiplier: number;
      smoothing: "RMA";
      switchStoploss: boolean;
      useConfirmed: boolean;
      modelStartingCapital: number;
      allocationPolicy: "equal_weight" | "weighted";
      maximumConcurrentPositions: number;
      transactionCostPercent: number;
      watchlist: Array<{
        signalTicker: string;
        executionTicker: string;
        enabled: boolean;
        allocationWeight: number;
      }>;
    };
    nasdaqSma200: {
      enabled: boolean;
      referenceTicker: string;
      riskOnTicker: string;
      watchlist: Array<{
        signalTicker: string;
        executionTicker: string;
        enabled: boolean;
        allocationWeight: number;
      }>;
      riskOffMode: "cash" | "instrument";
      riskOffTicker: string;
      smaLength: number;
      reviewCadence: "daily" | "weekly";
      riskOnThresholdPercent: number;
      riskOffThresholdPercent: number;
      modelStartingCapital: number;
      transactionCostPercent: number;
      annualInstrumentCostPercent: number;
    };
  };
  resources?: StrategyConfigurationResources;
}

export const defaultStrategyConfiguration: StrategyConfiguration = {
  version: 1,
  marketData: {
    provider: "stooq_csv",
    urlTemplate: "https://stooq.com/q/d/l/?s={ticker}&i=d",
    timeoutSeconds: 20,
    maximumRetries: 3,
  },
  strategies: {
    dailySuperTrend: {
      enabled: false,
      timeframe: "1d",
      referenceTimeframe: "D",
      atrLength: 20,
      atrPeriod: 20,
      multiplier: 3,
      smoothing: "RMA",
      switchStoploss: false,
      useConfirmed: true,
      modelStartingCapital: 10_000,
      allocationPolicy: "equal_weight",
      maximumConcurrentPositions: 5,
      transactionCostPercent: 0.1,
      watchlist: [],
    },
    nasdaqSma200: {
      enabled: false,
      referenceTicker: "",
      riskOnTicker: "",
      watchlist: [],
      riskOffMode: "cash",
      riskOffTicker: "",
      smaLength: 200,
      reviewCadence: "daily",
      riskOnThresholdPercent: 0,
      riskOffThresholdPercent: 0,
      modelStartingCapital: 10_000,
      transactionCostPercent: 0.1,
      annualInstrumentCostPercent: 0,
    },
  },
};

function objectValue(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function textValue(
  value: unknown,
  label: string,
  required = true,
  maximum = 120,
) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > maximum) throw new Error(`${label} is too long.`);
  return text;
}

function numberValue(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(
      `${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return number;
}

function enabledValue(value: unknown) {
  return value === true;
}

function tickerValue(value: unknown, label: string, required: boolean) {
  const ticker = textValue(value, label, required, 40).toUpperCase();
  if (ticker && !/^[A-Z0-9.^=_/-]+$/.test(ticker)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return ticker;
}

function publicMarketDataHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return false;
  }
  if (!isIP(host)) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) {
    return false;
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4) return true;
  return !(
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function validateStrategyConfiguration(
  value: unknown,
): StrategyConfiguration {
  const root = objectValue(value, "Strategy configuration");
  const marketData = objectValue(root.marketData, "Market data");
  const provider = textValue(
    marketData.provider,
    "Market-data provider",
  );
  if (!["stooq_csv", "url_template_csv"].includes(provider)) {
    throw new Error("Unsupported market-data provider.");
  }
  const urlTemplate = textValue(
    marketData.urlTemplate,
    "Market-data URL template",
  );
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlTemplate.replace("{ticker}", "ticker"));
  } catch {
    throw new Error("Market-data URL template must be a valid URL.");
  }
  if (
    parsedUrl.protocol !== "https:" ||
    !urlTemplate.includes("{ticker}") ||
    !publicMarketDataHost(parsedUrl.hostname)
  ) {
    throw new Error(
      "Market-data URL template must use HTTPS, include {ticker}, and use a public host.",
    );
  }

  const strategies = objectValue(root.strategies, "Strategies");
  const superTrend = objectValue(
    strategies.dailySuperTrend,
    "Daily SuperTrend",
  );
  const superEnabled = enabledValue(superTrend.enabled);
  const watchlistRaw = Array.isArray(superTrend.watchlist)
    ? superTrend.watchlist
    : [];
  const watchlist = watchlistRaw.map((value, index) => {
    const row = objectValue(value, `Watchlist row ${index + 1}`);
    const enabled = enabledValue(row.enabled);
    return {
      signalTicker: tickerValue(
        row.signalTicker,
        `Watchlist row ${index + 1} signal ticker`,
        enabled || superEnabled,
      ),
      executionTicker: tickerValue(
        row.executionTicker,
        `Watchlist row ${index + 1} execution ticker`,
        enabled || superEnabled,
      ),
      enabled,
      allocationWeight: numberValue(
        row.allocationWeight ?? 1,
        `Watchlist row ${index + 1} allocation weight`,
        0.01,
        100,
      ),
    };
  });
  if (superEnabled && !watchlist.some((row) => row.enabled)) {
    throw new Error(
      "Daily SuperTrend requires at least one enabled watchlist row.",
    );
  }
  const mappingKeys = watchlist
    .filter((row) => row.signalTicker || row.executionTicker)
    .map((row) => `${row.signalTicker}|${row.executionTicker}`);
  if (new Set(mappingKeys).size !== mappingKeys.length) {
    throw new Error("Daily SuperTrend watchlist mappings must be unique.");
  }
  const allocationPolicy = textValue(
    superTrend.allocationPolicy,
    "Allocation policy",
  );
  if (!["equal_weight", "weighted"].includes(allocationPolicy)) {
    throw new Error("Allocation policy must be equal_weight or weighted.");
  }
  const superTrendAtrLength = Math.round(
    numberValue(
      superTrend.atrLength ?? superTrend.atrPeriod ?? 20,
      "ATR length",
      2,
      500,
    ),
  );
  const superTrendSmoothing = textValue(
    superTrend.smoothing ?? "RMA",
    "SuperTrend smoothing",
  ).toUpperCase();
  if (superTrendSmoothing !== "RMA") {
    throw new Error(
      "SuperTrend smoothing must be RMA for TradingView parity.",
    );
  }
  const referenceTimeframe = textValue(
    superTrend.referenceTimeframe ?? "D",
    "SuperTrend reference timeframe",
  ).toUpperCase();
  if (referenceTimeframe !== "D") {
    throw new Error(
      "SuperTrend reference timeframe must be D for TradingView parity.",
    );
  }

  const sma = objectValue(
    strategies.nasdaqSma200,
    "Nasdaq SMA200 Regime",
  );
  const smaEnabled = enabledValue(sma.enabled);
  const smaWatchlistRaw = Array.isArray(sma.watchlist)
    ? sma.watchlist
    : [];
  const smaWatchlist = smaWatchlistRaw.map((value, index) => {
    const row = objectValue(value, `SMA200 watchlist row ${index + 1}`);
    const enabled = enabledValue(row.enabled);
    return {
      signalTicker: tickerValue(
        row.signalTicker,
        `SMA200 watchlist row ${index + 1} signal ticker`,
        enabled || (smaEnabled && smaWatchlistRaw.length > 0),
      ),
      executionTicker: tickerValue(
        row.executionTicker,
        `SMA200 watchlist row ${index + 1} execution ticker`,
        enabled || (smaEnabled && smaWatchlistRaw.length > 0),
      ),
      enabled,
      allocationWeight: numberValue(
        row.allocationWeight ?? 1,
        `SMA200 watchlist row ${index + 1} allocation weight`,
        0.01,
        100,
      ),
    };
  });
  if (smaEnabled && smaWatchlistRaw.length > 0 && !smaWatchlist.some((row) => row.enabled)) {
    throw new Error(
      "Nasdaq SMA200 requires at least one enabled watchlist row when watchlist rows are configured.",
    );
  }
  const smaMappingKeys = smaWatchlist
    .filter((row) => row.signalTicker || row.executionTicker)
    .map((row) => `${row.signalTicker}|${row.executionTicker}`);
  if (new Set(smaMappingKeys).size !== smaMappingKeys.length) {
    throw new Error("Nasdaq SMA200 watchlist mappings must be unique.");
  }
  const legacySmaRequired = smaEnabled && smaWatchlistRaw.length === 0;
  const riskOffMode = textValue(sma.riskOffMode, "Risk-off mode");
  if (!["cash", "instrument"].includes(riskOffMode)) {
    throw new Error("Risk-off mode must be cash or instrument.");
  }
  const riskOffTicker = tickerValue(
    sma.riskOffTicker,
    "Risk-off ticker",
    smaEnabled && riskOffMode === "instrument",
  );
  const reviewCadence = textValue(
    sma.reviewCadence,
    "Review cadence",
  );
  if (!["daily", "weekly"].includes(reviewCadence)) {
    throw new Error("Review cadence must be daily or weekly.");
  }

  return {
    version: 1,
    marketData: {
      provider: provider as StrategyConfiguration["marketData"]["provider"],
      urlTemplate,
      timeoutSeconds: Math.round(
        numberValue(
          marketData.timeoutSeconds ?? 20,
          "Market-data timeout",
          1,
          120,
        ),
      ),
      maximumRetries: Math.round(
        numberValue(
          marketData.maximumRetries ?? 3,
          "Market-data retry count",
          0,
          8,
        ),
      ),
    },
    strategies: {
      dailySuperTrend: {
        enabled: superEnabled,
        timeframe: textValue(
          superTrend.timeframe ?? "1d",
          "SuperTrend timeframe",
        ),
        referenceTimeframe,
        atrLength: superTrendAtrLength,
        atrPeriod: superTrendAtrLength,
        multiplier: numberValue(
          superTrend.multiplier ?? 3,
          "SuperTrend multiplier",
          0.1,
          20,
        ),
        smoothing: "RMA",
        switchStoploss: superTrend.switchStoploss === true,
        useConfirmed: superTrend.useConfirmed !== false,
        modelStartingCapital: numberValue(
          superTrend.modelStartingCapital,
          "SuperTrend model starting capital",
          1,
          1_000_000_000,
        ),
        allocationPolicy:
          allocationPolicy as StrategyConfiguration["strategies"]["dailySuperTrend"]["allocationPolicy"],
        maximumConcurrentPositions: Math.round(
          numberValue(
            superTrend.maximumConcurrentPositions,
            "Maximum concurrent positions",
            1,
            1000,
          ),
        ),
        transactionCostPercent: numberValue(
          superTrend.transactionCostPercent ?? 0,
          "SuperTrend transaction cost",
          0,
          20,
        ),
        watchlist,
      },
      nasdaqSma200: {
        enabled: smaEnabled,
        referenceTicker: tickerValue(
          sma.referenceTicker,
          "Nasdaq reference ticker",
          legacySmaRequired,
        ),
        riskOnTicker: tickerValue(
          sma.riskOnTicker,
          "Nasdaq risk-on ticker",
          legacySmaRequired,
        ),
        watchlist: smaWatchlist,
        riskOffMode:
          riskOffMode as StrategyConfiguration["strategies"]["nasdaqSma200"]["riskOffMode"],
        riskOffTicker,
        smaLength: Math.round(
          numberValue(sma.smaLength, "SMA length", 2, 1000),
        ),
        reviewCadence:
          reviewCadence as StrategyConfiguration["strategies"]["nasdaqSma200"]["reviewCadence"],
        riskOnThresholdPercent: numberValue(
          sma.riskOnThresholdPercent ?? 0,
          "Risk-on threshold",
          -50,
          50,
        ),
        riskOffThresholdPercent: numberValue(
          sma.riskOffThresholdPercent ?? 0,
          "Risk-off threshold",
          -50,
          50,
        ),
        modelStartingCapital: numberValue(
          sma.modelStartingCapital,
          "SMA model starting capital",
          1,
          1_000_000_000,
        ),
        transactionCostPercent: numberValue(
          sma.transactionCostPercent ?? 0,
          "SMA transaction cost",
          0,
          20,
        ),
        annualInstrumentCostPercent: numberValue(
          sma.annualInstrumentCostPercent ?? 0,
          "Annual instrument cost",
          0,
          20,
        ),
      },
    },
  };
}

const presetWarning = "Review tickers and enable the strategy only when ready.";

function presetConfiguration(
  configure: (configuration: StrategyConfiguration) => void,
) {
  const configuration = structuredClone(defaultStrategyConfiguration);
  configure(configuration);
  return validateStrategyConfiguration(configuration);
}

export const strategyTickerCatalogue: TickerCatalogueEntry[] = [
  {
    entryId: "nasdaq-100-etf-reference-example",
    label: "Example Nasdaq 100 ETF reference",
    symbol: "QQQ",
    marketDataSymbol: "QQQ.US",
    category: "Nasdaq reference",
    notes:
      "Template reference ticker only. Verify market-data coverage before enabling any strategy.",
    enabled: true,
  },
  {
    entryId: "nasdaq-100-index-reference-example",
    label: "Example Nasdaq 100 index reference",
    symbol: "NDX",
    marketDataSymbol: "^NDX",
    category: "Nasdaq reference",
    notes:
      "Template index reference only. Some market-data providers may use a different symbol.",
    enabled: true,
  },
  {
    entryId: "uk-leveraged-nasdaq-3x-example",
    label: "Example UK 3x Nasdaq instrument",
    symbol: "QQQ3",
    marketDataSymbol: "QQQ3.UK",
    category: "UK leveraged Nasdaq",
    notes:
      "Editable high-risk risk-on template. This is not investment advice.",
    enabled: true,
  },
  {
    entryId: "uk-broad-equity-etf-example",
    label: "Example UK broad equity ETF",
    symbol: "VWRP",
    marketDataSymbol: "VWRP.UK",
    category: "UK broad equity ETF",
    notes:
      "Editable broad-equity example for watchlist testing and mapping review.",
    enabled: true,
  },
  {
    entryId: "uk-risk-off-cash-like-example",
    label: "Example UK cash-like/risk-off instrument",
    symbol: "CSH2",
    marketDataSymbol: "CSH2.UK",
    category: "UK bond/cash-like/risk-off",
    notes:
      "Editable risk-off example. Leave risk-off mode as cash unless an instrument has been verified.",
    enabled: true,
  },
  {
    entryId: "watchlist-sp500-reference-example",
    label: "Example S&P 500 watchlist signal",
    symbol: "SPY",
    marketDataSymbol: "SPY.US",
    category: "Other watchlist",
    notes:
      "Editable watchlist signal example. Confirm the execution ticker before enabling a row.",
    enabled: true,
  },
  {
    entryId: "watchlist-uk-execution-example",
    label: "Example UK execution mapping",
    symbol: "3USL",
    marketDataSymbol: "3USL.UK",
    category: "Other watchlist",
    notes:
      "Editable execution-ticker example for SuperTrend mapping review.",
    enabled: true,
  },
];

export const strategyConfigurationPresets: StrategyConfigurationPreset[] = [
  {
    presetId: "nasdaq-sma-regime-3x",
    strategy: "nasdaqSma200",
    name: "Nasdaq SMA Regime — 3x",
    description:
      "Template for Nasdaq 100 SMA regime tracking using a UK-accessible risk-on instrument. Review all tickers before enabling.",
    warning: presetWarning,
    configuration: presetConfiguration((configuration) => {
      configuration.strategies.nasdaqSma200 = {
        enabled: false,
        referenceTicker: "QQQ.US",
        riskOnTicker: "QQQ3.UK",
        watchlist: [
          {
            signalTicker: "QQQ.US",
            executionTicker: "QQQ3.UK",
            enabled: false,
            allocationWeight: 1,
          },
        ],
        riskOffMode: "cash",
        riskOffTicker: "",
        smaLength: 200,
        reviewCadence: "daily",
        riskOnThresholdPercent: 0,
        riskOffThresholdPercent: 0,
        modelStartingCapital: 10_000,
        transactionCostPercent: 0.1,
        annualInstrumentCostPercent: 0,
      };
    }),
  },
  {
    presetId: "daily-supertrend-watchlist-template",
    strategy: "dailySuperTrend",
    name: "Daily SuperTrend watchlist template",
    description:
      "Template for daily SuperTrend virtual tracking. Review each ticker mapping before enabling.",
    warning: presetWarning,
    configuration: presetConfiguration((configuration) => {
      configuration.strategies.dailySuperTrend = {
        enabled: false,
        timeframe: "1d",
        referenceTimeframe: "D",
        atrLength: 20,
        atrPeriod: 20,
        multiplier: 3,
        smoothing: "RMA",
        switchStoploss: false,
        useConfirmed: true,
        modelStartingCapital: 10_000,
        allocationPolicy: "equal_weight",
        maximumConcurrentPositions: 5,
        transactionCostPercent: 0.1,
        watchlist: [
          {
            signalTicker: "SPY.US",
            executionTicker: "3USL.UK",
            enabled: false,
            allocationWeight: 1,
          },
          {
            signalTicker: "QQQ.US",
            executionTicker: "QQQ3.UK",
            enabled: false,
            allocationWeight: 1,
          },
        ],
      };
    }),
  },
];

export function strategyConfigurationResources(): StrategyConfigurationResources {
  return {
    presets: strategyConfigurationPresets.map((preset) => ({
      ...preset,
      configuration: structuredClone(preset.configuration),
    })),
    tickerCatalogue: strategyTickerCatalogue.map((entry) => ({ ...entry })),
  };
}

function withStrategyConfigurationResources(
  configuration: StrategyConfiguration,
): StrategyConfiguration {
  return {
    ...configuration,
    resources: strategyConfigurationResources(),
  };
}

export class StrategyConfigurationRepository {
  private readonly store: JsonStore;
  private readonly filename = "strategy_config_v1.json";

  constructor(directory?: string) {
    this.store = new JsonStore(
      path.resolve(
        directory ??
          process.env.SCANNER_CONFIG_DIR ??
          path.join(process.cwd(), "data", "scanner-config"),
      ),
    );
  }

  async read() {
    const value =
      await this.store.readOptional<StrategyConfiguration>(this.filename);
    return withStrategyConfigurationResources(
      value
        ? validateStrategyConfiguration(value)
        : structuredClone(defaultStrategyConfiguration),
    );
  }

  async update(value: unknown) {
    const configuration = validateStrategyConfiguration(value);
    await this.store.write(this.filename, configuration);
    return withStrategyConfigurationResources(configuration);
  }
}
