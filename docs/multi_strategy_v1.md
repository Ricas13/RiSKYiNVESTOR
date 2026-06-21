# `multi_strategy_v1.json`

The integrated Python scanner is the sole writer of
`scanner_output/multi_strategy_v1.json`. The dashboard mounts that volume
read-only, validates each complete snapshot, and preserves its last known good
copy in private dashboard storage when a newer file is malformed.

The file is written atomically using a temporary file, file flush/fsync where
supported, and rename.

Top-level fields:

- `schemaVersion`: always `multi_strategy_v1`
- `generatedAt`: UTC ISO-8601 timestamp
- `scanner`: scanner name/version, `status`, safe errors and data freshness
- `strategies`: independent Daily SuperTrend and Nasdaq SMA200 Regime — 3x
  records

Each strategy record contains:

- `strategyId`, `name`, `enabled`, `configured`, `status`
- `ruleSummary` and the validated non-secret `parameters`
- `currentState`, `modelValue`, `returnPercent`, `drawdownPercent`,
  `exposurePercent`
- `equitySnapshots`
- `virtualPositions` labelled `Virtual model position`
- `closedVirtualTrades`
- stable, deduplicated `events`
- `latestEvent` and `dataFreshness`

When a material strategy parameter changes, the scanner does not blend the new
configuration with the previous virtual state. It preserves the old strategy
state in `model_state_v1.json`, marks the public strategy record as
`status: "rebuild_required"`, and waits for an explicit `--rebuild-history`
run. A rebuild clears the rebuild-required marker and reconstructs the strategy
chronologically from historical market bars.

Daily SuperTrend virtual positions additionally expose signal and execution
tickers, in/out state, entry/latest prices, P/L, days held, allocation and the
latest signal reason.

Daily SuperTrend replay processes every historical bar and transition in date
order. For `equal_weight`, each admitted position receives:

`modelStartingCapital / maximumConcurrentPositions`

Unused model capital stays as cash. For `weighted`, allocation weights are
normalised across enabled watchlist rows only; capital reserved for rows that
are disabled, missing data, or blocked by the concurrency cap is not reassigned
and remains cash.

Nasdaq SMA records additionally expose risk-on/risk-off state, regime start,
reference/execution tickers, cash, invested value, equity history and
regime-change events.

The SMA strategy stores the last evaluated market period. Daily cadence
evaluates once per completed daily bar. Weekly cadence evaluates only completed
weekly closes, so a partial current week cannot flip the model mid-week.

Annual instrument cost is accrued only for completed market days while the
virtual model is invested. The scanner persists the last cost-accrual date in
durable state and rebuilds the same cost history deterministically, preventing
double charging on repeated scans.

The two strategy records are never blended, compared for agreement, or used to
override one another.
