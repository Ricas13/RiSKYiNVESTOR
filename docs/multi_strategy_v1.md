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

Daily SuperTrend virtual positions additionally expose signal and execution
tickers, in/out state, entry/latest prices, P/L, days held, allocation and the
latest signal reason.

Nasdaq SMA records additionally expose risk-on/risk-off state, regime start,
reference/execution tickers, cash, invested value, equity history and
regime-change events.

The two strategy records are never blended, compared for agreement, or used to
override one another.
