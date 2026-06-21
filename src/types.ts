export type RiskTier = "CORE" | "AGGRESSIVE" | "SPECULATIVE" | "EXCLUDED";
export type Trend = "Green" | "Red" | "Unknown";
export type Liquidity = "Good" | "Moderate" | "Low";
export type SignalState =
  | "actionable_entry"
  | "actionable_exit"
  | "watchlist_only"
  | "wait_review"
  | "no_change"
  | "low_liquidity_warning"
  | "scanner_error"
  | "informational";
export type TrendState = "green" | "red" | "unknown";
export type EventEligibility =
  | "eligible"
  | "ineligible"
  | "watchlist_only"
  | "excluded"
  | "blocked_by_risk_rule"
  | "unknown";
export type NotificationDeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped"
  | "disabled";
export type SignalDecisionStatus =
  | "Taken"
  | "Skipped"
  | "Missed"
  | "Ignored due to risk"
  | "Entered late"
  | "Exited manually"
  | "Partially taken"
  | "Paper only";
export type AlertStatus = "unread" | "read" | "actioned" | "ignored";
export type AlertType =
  | "ENTRY"
  | "EXIT"
  | "TAKE PROFIT"
  | "DAILY SUMMARY"
  | "ERROR"
  | "LIQUIDITY";

export interface Summary {
  strategyName: string;
  lastScan: string;
  greenTickers: number;
  redTickers: number;
  entrySignalsToday: number;
  exitSignalsToday: number;
  openModelTrades: number;
  realisedModelPL: number;
  dataStatus: string;
}

export interface WatchlistItem {
  id: string;
  assetName: string;
  category: string;
  entryTicker: string;
  tradeTicker: string;
  riskTier: RiskTier;
  currentTrend: Trend;
  latestClose: number;
  currency: string;
  superTrendValue: number;
  lastSignalDate: string;
  liquidityStatus: Liquidity;
  allocationRule: string;
  notes: string;
}

export interface Signal {
  id: string;
  strategyName?: string;
  title: string;
  assetName: string;
  signalType: "ENTRY" | "EXIT" | "TAKE PROFIT" | "HOLD";
  underlyingTicker: string;
  tradeTicker: string;
  signalDate: string;
  suggestedAction: string;
  riskTier: RiskTier;
  suggestedAllocation: string;
  liquidityWarning: string | null;
  referenceClose: number;
  currency: string;
  superTrendValue: number;
}

export interface ArchivedSignal extends Signal {
  modelExitDate: string | null;
  modelExitPrice: number | null;
}

export interface OpenTrade {
  id: string;
  assetName: string;
  tradeTicker: string;
  entryTicker: string;
  openAlertDate: string;
  referenceOpenPrice: number;
  currentReferencePrice: number;
  modelPLPercent: number;
  riskTier: RiskTier;
  allocationPercent: number;
  takeProfitStatus: string;
  notes: string;
}

export interface ClosedTrade {
  id: string;
  assetName: string;
  tradeTicker: string;
  openDate: string;
  closeDate: string;
  entryPrice: number;
  exitPrice: number;
  modelPLPercent: number;
  outcome: "Win" | "Loss";
  riskTier: RiskTier;
}

export interface ClosedTradesData {
  trades: ClosedTrade[];
}

export interface Performance {
  realisedModelPL: number;
  averageClosedTrade: number;
  medianClosedTrade: number;
  winRate: number;
  closedTrades: number;
  fixedStakeEquivalent: number;
  realisedSeries: Array<{ date: string; value: number }>;
  yearlyPL: Array<{ year: string; value: number }>;
  winLoss: Array<{ name: string; value: number }>;
  openTradePL: Array<{ ticker: string; value: number }>;
}

export interface SiteConfig {
  site: {
    name: string;
    domain: string;
    mode: "public" | "private";
    defaultTheme: "dark" | "light";
  };
  strategy: {
    name: string;
    timeframe: string;
    atrLength: number;
    entryRule: string;
    exitRule: string;
    directionConvention: string;
    ignoredRegimes: number[];
  };
  riskTiers: Record<RiskTier, { allocation: string; status: string }>;
  channels: {
    entryAlerts: string;
    exitAlerts: string;
    takeProfitAlerts: string;
  };
  display: {
    showFixedStakeEquivalent: boolean;
    currency: string;
    compactTablesOnMobile: boolean;
  };
  backtests: {
    baseline: Backtest;
    secondaryTests: SecondaryTest[];
  };
}

export interface Backtest {
  title: string;
  startingCapital: number;
  finalEquity: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  closedTrades: number;
  skippedSignals: number;
  averageTrade: number;
  medianTrade: number;
  winRate: number;
}

export interface SecondaryTest {
  name: string;
  status: string;
  stats?: Record<string, number>;
  notes: string;
}

export interface DashboardData {
  summary: Summary;
  watchlist: WatchlistItem[];
  signals: Signal[];
  openTrades: OpenTrade[];
  closedTrades: ClosedTradesData;
  performance: Performance;
  config: SiteConfig;
  manualTrades: ManualTradeFile;
  wealthSnapshots: WealthSnapshotFile;
  cashFlows: CashFlowFile;
  account: AccountFile;
  strategies: StrategyRegistryFile;
  settings: DashboardSettings;
  signalArchive: ArchivedSignal[];
  signalDecisions: SignalDecisionFile;
  alerts: AlertFile;
  signalEvents: SignalEventFile;
  notifications: NotificationPublicState;
  dailyPL: DailyPLReport;
  latestPortfolioSnapshot: DailyPortfolioSnapshot | null;
  scannerImport: ScannerImportState;
  strategyMonitor: MultiStrategyPublicState;
  strategyConfiguration: StrategyConfiguration;
  dataStatus: DataStatusReport;
}

export type StrategyId = "daily-supertrend" | "nasdaq-sma200-3x";
export type StrategyEventType =
  | "entry"
  | "exit"
  | "lowLiquidity"
  | "stateUpdate"
  | "dailySummary"
  | "weeklySummary"
  | "scannerError";

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
      atrPeriod: number;
      multiplier: number;
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

export interface MultiStrategyEvent {
  eventId: string;
  strategyId: StrategyId;
  eventType: StrategyEventType;
  occurredAt: string;
  signalTicker: string;
  executionTicker: string;
  reason: string;
}

export interface MultiStrategyPosition {
  positionId: string;
  label: "Virtual model position";
  signalTicker: string;
  executionTicker: string;
  state: string;
  entryTimestamp: string | null;
  entryPrice: number | null;
  latestPrice: number | null;
  quantity: number;
  allocation: number;
  openPnlValue: number;
  openPnlPercent: number;
  daysHeld: number;
  latestSignal: string;
  reason: string;
}

export interface MultiStrategyRecord {
  strategyId: StrategyId;
  name: string;
  enabled: boolean;
  configured: boolean;
  status: string;
  ruleSummary: string;
  parameters: Record<string, unknown>;
  currentState: string;
  modelValue: number | null;
  returnPercent: number | null;
  drawdownPercent: number | null;
  exposurePercent: number;
  cash?: number;
  investedValue?: number;
  regimeStartDate?: string | null;
  referenceTicker?: string;
  executionTicker?: string;
  equitySnapshots: Array<{ date: string; value: number }>;
  virtualPositions: MultiStrategyPosition[];
  closedVirtualTrades: Array<Record<string, unknown>>;
  events: MultiStrategyEvent[];
  regimeChangeEvents?: MultiStrategyEvent[];
  latestEvent: MultiStrategyEvent | null;
  dataFreshness: string | null;
}

export interface MultiStrategySnapshot {
  schemaVersion: "multi_strategy_v1";
  generatedAt: string;
  scanner: {
    name: string;
    version: string;
    status: string;
    errors: Array<{ strategyId?: string; message: string }>;
    dataFreshness: {
      generatedAt: string;
      staleAfterMinutes: number;
    } | null;
  };
  strategies: MultiStrategyRecord[];
}

export interface MultiStrategyPublicState {
  source: "current" | "last_known_good" | "awaiting";
  currentFileValid: boolean;
  lastError: string | null;
  snapshot: MultiStrategySnapshot | null;
}

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

export interface DataCleanupPreview {
  report: DataStatusReport;
  confirmationText: "REMOVE DEMO DATA";
  backupDownloaded: boolean;
  backupReceiptExpiresMinutes: number;
}

export interface SignalEvent {
  eventId: string;
  eventVersion: 1;
  occurredAt: string;
  receivedAt: string;
  strategyId: string;
  strategyName: string;
  source: string;
  underlyingTicker: string;
  underlyingName: string;
  tradeTicker: string;
  tradeName: string;
  signalState: SignalState;
  previousTrend: TrendState;
  currentTrend: TrendState;
  riskTier: RiskTier;
  eligibility: EventEligibility;
  allocationStatus:
    | "normal"
    | "reduced"
    | "zero"
    | "blocked"
    | "not_applicable"
    | "unknown";
  allocationPercent: number;
  reasonCode: string;
  reasonText: string;
  scannerRunId: string;
  rawSourceReference: string;
  isActionable: boolean;
  isAcknowledged: boolean;
  discordDeliveryEligible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SignalEventFile {
  version: 2;
  isExample: boolean;
  notice?: string;
  events: SignalEvent[];
}

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
  strategyPolicies: Record<
    StrategyId,
    Record<StrategyEventType, string[]>
  >;
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

export interface NotificationDelivery {
  deliveryId: string;
  eventId: string | null;
  notificationKey: string;
  destinationId?: string | null;
  destinationLabel?: string | null;
  channel:
    | "dashboard"
    | "discord"
    | "whatsapp"
    | "daily_summary"
    | "weekly_summary";
  status: NotificationDeliveryStatus;
  attemptedAt: string;
  deliveredAt: string | null;
  errorMessage: string | null;
  providerReference: string | null;
  retryCount: number;
  category?: "signal" | "daily_summary" | "weekly_summary" | "test";
  message?: string;
}

export interface NotificationPublicState {
  settings: NotificationSettings;
  providers: {
    discord: {
      configured: boolean;
      available: boolean;
      maskedEnding: string | null;
      lastSuccessfulDeliveryAt: string | null;
      latestResult: NotificationDeliveryStatus | null;
      destinations: DiscordDestination[];
      legacyDestination: DiscordDestination | null;
    };
    whatsapp: {
      configured: boolean;
      available: boolean;
      maskedEnding: string | null;
      lastSuccessfulDeliveryAt: string | null;
      latestResult: NotificationDeliveryStatus | null;
    };
  };
  retention: { retained: number; maximum: number };
  deliveries: NotificationDelivery[];
}

export interface DiscordDestination {
  destinationId: string;
  label: string;
  displayName: string | null;
  avatarUrl: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastTestAt: string | null;
  lastSuccessfulDeliveryAt: string | null;
  latestResult: NotificationDeliveryStatus | null;
  maskedEnding: string;
  legacy: boolean;
  editable: boolean;
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

export interface DailyPortfolioSnapshot {
  snapshotId: string;
  timestamp: string;
  date: string;
  actualPortfolioValue: number | null;
  modelPortfolioValue: number | null;
  actualDailyPnl: number | null;
  modelDailyPnl: number | null;
  realisedPnl: number | null;
  unrealisedPnl: number | null;
  contributions: number | null;
  withdrawals: number | null;
  currentDrawdownPercent: number | null;
  cashValue: number | null;
  investedValue: number | null;
  source: string;
  scannerRunId: string;
}

export interface ScannerImportState {
  status: "awaiting" | "current" | "stale" | "error";
  lastGeneratedAt: string | null;
  lastSuccessfulScanAt: string | null;
  lastImportedAt: string | null;
  staleAfterMinutes: number;
  scannerName: string | null;
  scannerRunId: string | null;
  summary: string | null;
  warningCount: number;
  errorCount: number;
  lastError: string | null;
  importedEvents: number;
  duplicateEvents: number;
  rejectedEvents: number;
}

export interface TradeExit {
  id: string;
  exitDate: string;
  exitPrice: number;
  quantitySold: number;
  fees: number;
  reason: string;
  notes: string;
}

export interface ManualTrade {
  id: string;
  strategyName: string;
  sleeve?: "SuperTrend" | "SMA200 Regime" | "Discretionary / untagged";
  assetName: string;
  ticker: string;
  direction: "long" | "cash" | "other";
  riskTier?: RiskTier;
  assetClass?: string;
  isTechnology?: boolean;
  isSingleStock?: boolean;
  leverageMultiplier?: number;
  entryDate: string;
  entryPrice: number;
  quantity: number;
  amountInvested: number;
  fees: number;
  notes: string;
  source: "manual" | "Discord alert" | "imported";
  referenceLink: string;
  currentPrice: number;
  journal?: TradeJournal;
  exits: TradeExit[];
  createdAt: string;
  updatedAt: string;
}

export interface TradeJournal {
  entryReason: string;
  followedSystem: boolean;
  overrodeSystem: boolean;
  emotionalState: string;
  checkedChart: boolean;
  lesson: string;
}

export interface ManualTradeFile {
  isExample: boolean;
  notice?: string;
  trades: ManualTrade[];
}

export interface WealthSnapshot {
  id: string;
  date: string;
  totalPortfolioValue: number;
  cashBalance: number;
  investedValue: number;
  notes: string;
}

export interface WealthSnapshotFile {
  isExample: boolean;
  notice?: string;
  snapshots: WealthSnapshot[];
}

export interface CashFlow {
  id: string;
  date: string;
  type: "deposit" | "withdrawal";
  amount: number;
  notes: string;
}

export interface CashFlowFile {
  isExample: boolean;
  notice?: string;
  cashFlows: CashFlow[];
}

export interface AuthSession {
  authenticated: true;
  username: string;
  role: "owner" | "user" | "admin";
  csrfToken: string;
}

export interface Account {
  id: string;
  username: string;
  displayName: string;
  role: "owner" | "user" | "admin";
  currency: string;
  createdAt: string;
}

export interface AccountFile {
  isExample: boolean;
  notice?: string;
  account: Account;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  status: "active" | "tracking" | "manual" | "paused";
  timeframe: string;
  description: string;
  historicalQuality: number;
  defaultAssumedStake: number;
}

export interface StrategyRegistryFile {
  isExample: boolean;
  notice?: string;
  strategies: StrategyDefinition[];
}

export interface SignalDecision {
  signalId: string;
  status: SignalDecisionStatus;
  manualTradeId: string | null;
  notes: string;
  assumedStake: number;
  updatedAt: string;
}

export interface SignalDecisionFile {
  isExample: boolean;
  notice?: string;
  decisions: SignalDecision[];
}

export interface AlertRecord {
  id: string;
  strategyName: string;
  alertType: AlertType;
  createdAt: string;
  ticker: string;
  message: string;
  signalId: string | null;
  manualTradeId: string | null;
  status: AlertStatus;
}

export interface AlertFile {
  isExample: boolean;
  notice?: string;
  alerts: AlertRecord[];
}

export interface DashboardSettings {
  isExample: boolean;
  notice?: string;
  assumedMissedStake: number;
  riskLimits: {
    maxTickerPct: number;
    maxTechnologyPct: number;
    maxSpeculativePct: number;
    maxLeveraged3xPct: number;
    minimumCashPct: number;
    elevatedDrawdownPct: number;
  };
}
