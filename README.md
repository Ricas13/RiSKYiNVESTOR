# Risky Investor — Private Dashboard

A private, mobile-first investment command centre for:

1. **Model and signal performance**
2. **Actual manual trade performance**
3. **Overall portfolio and wealth growth**

These three areas are deliberately separated throughout the interface. The
system is alert-only and never connects to a broker or places trades.

## Security architecture

- Express serves the production frontend and protected JSON API.
- All dashboard data lives outside the public web build.
- Unauthenticated dashboard routes redirect to `/login`.
- Passwords are stored as scrypt hashes, never plaintext.
- Sessions use signed, expiring, HTTP-only cookies.
- Cookies are `Secure` in production and use `SameSite=Strict`.
- Every data mutation requires a session-bound CSRF token.
- Login attempts are rate-limited in memory.
- Security headers include CSP, frame denial and restrictive permissions.
- Credentials, session secrets and private records are ignored by Git.

The browser bundle contains no credentials, password hashes, webhook URLs,
broker secrets or private financial JSON.

## Requirements

- Node.js 20 or newer
- Python 3.12 for the integrated scanner
- npm, pnpm or yarn
- HTTPS for production

## First-time setup

Install dependencies:

```bash
npm install
```

Create a strong password hash:

```bash
npm run hash-password -- "a-long-password-manager-generated-password"
```

Copy `.env.example` to `.env` and set:

```dotenv
RISKY_INVESTOR_USERNAME=your-private-username
RISKY_INVESTOR_PASSWORD_HASH=scrypt$16384$8$1$...
RISKY_INVESTOR_ROLE=owner
SESSION_SECRET=at-least-32-random-characters

PORT=4180
NODE_ENV=development
SESSION_TTL_HOURS=12
```

Generate a session secret with a password manager or:

```bash
openssl rand -base64 48
```

Never put a plaintext password in `.env`. Only paste the output from
`npm run hash-password`.

## Development

```bash
npm run dev
```

- Frontend: `http://localhost:4173`
- Private API server: `http://localhost:4180`

Vite proxies `/api` to the private server. The dashboard remains hidden behind
the login screen in development.

## Production

```bash
npm run build
NODE_ENV=production npm start
```

The build creates:

- `dist/` — static browser assets containing no private data
- `dist-server/` — the private Express server

Run the server from the project root so it can find `dist/` and
`data/private/`.

Set `PRIVATE_DATA_DIR` to an absolute path if private records should live on a
separate encrypted disk or persistent volume.

## Docker and Traefik

The project now includes a multi-stage production image, Compose secret mounts,
a persistent private-data volume, local and Traefik Compose overlays, health
checks, and an optional Traefik v3 deployment.

See [DOCKER.md](./DOCKER.md) for:

- local Docker startup
- Traefik and Let's Encrypt setup
- production image tagging and registry publishing
- rollback to an earlier image
- isolated branch/preview deployments with separate data volumes
- private-data migration and backup guidance

## Private JSON data

The tracked fake fixtures illustrate the private file shapes:

```text
data/private/
├── manual_trades.json
├── open_positions.json
├── closed_trades.json
├── wealth_snapshots.json
├── cash_flows.json
└── model/
    ├── latest_summary.json
    ├── watchlist_status.json
    ├── open_trades.json
    ├── closed_trades.json
    ├── signals_today.json
    ├── performance.json
    └── site_config.json
```

Production startup never reads `*.example.json`. Missing runtime-owned files
are created inside `PRIVATE_DATA_DIR` with empty or disabled defaults; existing
valid files are left untouched and malformed JSON is never replaced.

The server uses atomic temporary-file replacement when saving JSON. The
`open_positions.json` and `closed_trades.json` views are regenerated from
`manual_trades.json`.

## Canonical scanner event contract

The repository includes a self-contained Python 3.12 scanner under `scanner/`.
It retrieves daily prices directly from the configured public HTTPS
market-data provider, calculates the two independent virtual strategies, and
writes `multi_strategy_v1.json` atomically. It never sends notifications,
places broker orders, or reads dashboard secrets/private data.

Run the scanner directly with:

```bash
python -m risky_investor_scanner --once
python -m risky_investor_scanner --loop
python -m risky_investor_scanner --rebuild-history
```

Docker Compose isolates scanner configuration, output, and durable model state
in `scanner_config`, `scanner_output`, and `scanner_state`. The dashboard can
write only configuration and can read only scanner output. The scanner cannot
access the dashboard private-data volume, Discord encryption keys, or session
secrets.

See [docs/multi_strategy_v1.md](./docs/multi_strategy_v1.md) for the scanner
output contract.

The dashboard also retains its previous canonical scanner import path for
backwards-compatible owner data. It accepts explicit, normalised scanner facts
and rejects inconsistent actionable states.

`SignalEvent` schema version 1 requires:

```text
eventId, eventVersion, occurredAt, receivedAt, strategyId, strategyName,
source, underlyingTicker, underlyingName, tradeTicker, tradeName,
signalState, previousTrend, currentTrend, riskTier, eligibility,
allocationStatus, allocationPercent, reasonCode, reasonText, scannerRunId,
rawSourceReference, isActionable, isAcknowledged, createdAt, updatedAt
```

Scanner exports may also include `discordDeliveryEligible`, a non-delivery
audit flag indicating whether the scanner's existing Discord rules would
consider the event. It does not cause the dashboard to contact Discord.

Allowed `signalState` values are:

```text
actionable_entry
actionable_exit
watchlist_only
wait_review
no_change
low_liquidity_warning
scanner_error
informational
```

An `actionable_entry` must explicitly contain a red-to-green transition,
eligible status, a positive allocation, and `isActionable: true`. An
`actionable_exit` must explicitly contain a green-to-red transition. The
dashboard validates these declarations but never derives them from current
trend colour.

Fictional examples:

- `examples/signal-event.example.json`
- `examples/daily-portfolio-snapshot.example.json`

### Server-side scanner import

The authenticated server checks this private directory on dashboard reads:

```text
/opt/risky-investor-data/scanner/
```

It consumes:

```text
latest-scan.json
signal-events.jsonl
watchlist-state.json
scanner-health.json
```

Set `SCANNER_EXPORT_DIR` only when a different private local path is required.
Set `SCANNER_STALE_MINUTES` to change the default 180-minute stale threshold.
No public scanner-ingestion endpoint is exposed.

For a fictional owner-session test, wrap the example event in a
`signalEvents` array and submit it to the existing authenticated, CSRF-protected
manual import route:

```bash
jq -n --slurpfile event examples/signal-event.example.json \
  '{signalEvents: $event}' > /tmp/risky-signal-test.json

curl --fail-with-body \
  --cookie /tmp/risky-owner-cookie.txt \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $RISKY_CSRF_TOKEN" \
  --data-binary @/tmp/risky-signal-test.json \
  http://127.0.0.1:4180/api/import/signals-json
```

The route records dashboard delivery as sent but does not derive or promote a
signal. Repeating the same event is idempotent.

### Canonical notifications

Discord delivery is server-side and consumes the same canonical
`SignalEvent`, `AlertDelivery`, and `DailyPortfolioSnapshot` records as the
dashboard. The browser never receives the webhook URL. Settings responses
contain only configured/not-configured state, a masked four-character ending,
and delivery audit metadata.

The default migration state is deliberately safe:

- legacy scanner Discord recorded as enabled
- canonical dashboard Discord disabled
- Discord notifications disabled
- daily summaries disabled
- WhatsApp not connected; no provider, credentials, API calls, or delivery

Canonical signal delivery is idempotent by event ID. Daily summaries are
idempotent by local report date and timezone, use only canonical snapshot
values, and will not invent missing values. Stale scanner data is suppressed
unless the owner explicitly enables stale summaries.

The in-process server scheduler checks the configured local summary time. It
does not depend on a browser tab or client timer. Failed Discord attempts can
be retried from Alerts; re-sending a successful notification requires an
explicit confirmation.

See `DOCKER.md` for private webhook setup and the duplicate-safe scanner
cutover procedure.

### Integrated virtual strategy models

The Strategy Configuration settings area is owner/admin and CSRF protected.
Both strategies start disabled with no assumed ticker mappings. Scanner
positions are always labelled `Virtual model position`; they never create an
actual trade. Actual trades remain manually entered and may optionally be
tagged to the SuperTrend, SMA200 Regime, or discretionary sleeve.

Strategy-specific Discord policies default to website history only. Owners can
route each strategy/event type to one or more encrypted managed Discord
destinations without exposing webhook URLs.

## Manual trades

The private interface supports:

- real entries with price, quantity, invested capital and fees
- manual, Discord-alert and imported sources
- editable current reference prices
- partial or full exits
- realised and unrealised P/L in pounds and percent
- open value, total return and holding period
- open/closed and win/loss status
- edit and confirmation-protected delete actions
- optional reference or screenshot links
- risk tier, asset class, technology, single-stock and leverage classification
- entry rationale, system-following, overrides, emotional state and lessons
- journal analytics comparing system-following and overridden trades

## Advanced operating dashboard

The authenticated dashboard also includes:

- **Today’s Actions** — mobile-first entry, exit, take-profit and liquidity review
- **Signal vs Actual** — link model signals to real trades and quantify decision impact
- **Missed Signal Tracker** — estimate missed winners, avoided losers and net opportunity
- **Alerts Inbox** — archive alert types with unread, read, actioned and ignored status
- **Risk Exposure** — concentration by ticker, strategy, tier and asset class
- **Drawdown Pain** — peak, current and worst drawdown, days below peak and recovery gain
- **Scenario Simulator** — contribution, CAGR, fee and target-wealth projections
- **Confidence Labels** — signal quality based on tier, liquidity, trend, drawdown and strategy quality
- **Data Portability** — JSON/CSV export, CSV/JSON import, backup and restore

All advanced records remain server-side, authenticated and exportable. The app
does not connect to a broker, execute trades, process payments or provide
financial advice.

## Wealth dashboard

The private wealth ledger supports:

- portfolio snapshots
- cash and invested value
- deposits and withdrawals
- current wealth and net capital
- gain/loss and simple return estimates
- month-to-date and year-to-date changes
- all-time high and drawdown
- actual win rate, average winner and average loser
- portfolio growth, invested-capital, monthly P/L, cash-flow, drawdown,
  strategy-contribution and allocation charts

The data layer is intentionally simple and can later be replaced by
PostgreSQL or Supabase behind the same API.

## VPS deployment for riskyinvestor.co.uk

Recommended layout:

```text
/opt/risky-investor/
├── dist/
├── dist-server/
├── data/private/
├── .env
└── package.json
```

Run the Node process with systemd, PM2 or another supervisor. Keep `.env` and
`data/private` readable only by the service account:

```bash
chmod 600 /opt/risky-investor/.env
chmod -R 700 /opt/risky-investor/data/private
```

Example Nginx reverse proxy:

```nginx
server {
    listen 80;
    server_name riskyinvestor.co.uk www.riskyinvestor.co.uk;

    location / {
        proxy_pass http://127.0.0.1:4180;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set these production values:

```dotenv
NODE_ENV=production
TRUST_PROXY=1
```

Enable HTTPS immediately:

```bash
sudo certbot --nginx -d riskyinvestor.co.uk -d www.riskyinvestor.co.uk
```

Secure cookies will not work correctly over plain HTTP in production.

## Backups and privacy

- Back up `.env` and `data/private/` separately and encrypt the backup.
- Do not commit real JSON data or `.env`.
- Do not serve `data/private` with Nginx.
- Do not place Discord webhooks or broker/account credentials in frontend
  configuration.
- Rotate `SESSION_SECRET` to invalidate every active session.
- Generate a new password hash when changing the dashboard password.
- Use host-level firewall rules so only Nginx can reach the Node port.

## Commands

```bash
npm run dev
npm run build
npm test
npm start
npm run lint
npm run hash-password -- "your-new-password"
```

`npm test` performs a clean production build, then runs isolated integration
tests against a temporary private-data directory. The tests cover session
authentication, protected dashboard access, CSRF enforcement, manual trade and
exit lifecycle, derived open/closed trade views, logout, and private JSON path
containment. No real private records are read or changed.

## Disclaimer

This dashboard is for personal tracking, signals, research and education. It is
not financial advice. Leveraged ETPs are high risk, backtests do not guarantee
future results, data sources can differ, and every alert should be manually
sanity-checked. The software does not execute trades.
