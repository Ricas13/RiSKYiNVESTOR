# Docker and Traefik deployment

The Docker deployment keeps the application image immutable while storing all
personal records in a separate persistent volume. The same image can be tagged,
promoted, rolled back, or run as an isolated preview stack.

## What is included

- Multi-stage Node.js production image
- Non-root runtime user
- Read-only container filesystem
- Persistent `/app/data/private` volume
- Docker Compose secret mounts
- Docker and Traefik health checks
- Localhost-only Compose override
- Traefik HTTP-to-HTTPS routing and Let's Encrypt support
- Separate Compose project names, router names, domains, and volumes for branch previews

The runtime image contains an empty writable private-data directory. It does
not copy `*.example.json` fixtures into the image or use them during startup.
Real records, secret files, `.env` files, build output, and local databases are
excluded from the Docker build context.

## 1. Prepare deployment settings

Copy the non-secret settings template:

```bash
cp .env.docker.example .env.docker
```

Create the three runtime secret files:

```bash
mkdir -p secrets
printf '%s' 'your-private-username' > secrets/username
openssl rand -base64 48 | tr -d '\n' > secrets/session_secret
```

Generate a password hash without installing Node.js locally:

```bash
docker build --target tools -t risky-investor-tools .
docker run --rm risky-investor-tools \
  'a-long-password-manager-generated-password' > secrets/password_hash
```

Protect the files:

```bash
chmod 600 secrets/username secrets/password_hash secrets/session_secret
```

The plaintext dashboard password is used only by the one-off hashing container.
Do not save it in Compose, Git, an image layer, or a secret file.

## 2. Test locally

The local override binds only to `127.0.0.1` and disables secure cookies so
login works over local HTTP:

```bash
docker compose \
  --env-file .env.docker \
  -f compose.yml \
  -f compose.local.yml \
  up -d --build
```

Open `http://127.0.0.1:4180`.

Useful checks:

```bash
docker compose \
  --env-file .env.docker \
  -f compose.yml \
  -f compose.local.yml \
  ps

curl http://127.0.0.1:4180/healthz
```

Stop the stack while retaining its private-data volume:

```bash
docker compose --env-file .env.docker -f compose.yml -f compose.local.yml down
```

Do not add `-v` unless you intentionally want to delete the stack's private
data volume.

## 3. Start Traefik on a new VPS

Skip this section if the server already has Traefik with Docker discovery,
`web` and `websecure` entrypoints, and a certificate resolver named
`letsencrypt`.

Point the domain's DNS `A` and optional `AAAA` records at the VPS. Allow inbound
TCP ports 80 and 443.

```bash
cd deploy/traefik
cp .env.example .env
```

Set a real ACME email address in `deploy/traefik/.env`, then start Traefik:

```bash
docker compose up -d
cd ../..
```

This creates the shared `traefik_proxy` network, redirects HTTP to HTTPS, and
stores Let's Encrypt state in a persistent Docker volume. The Traefik dashboard
is not exposed.

The Docker socket grants powerful host access even when mounted read-only.
For a hardened multi-tenant server, place a Docker socket proxy between
Traefik and the Docker daemon.

## 4. Deploy Risky Investor through Traefik

Review these values in `.env.docker`:

```dotenv
RISKY_INVESTOR_DOMAIN=riskyinvestor.co.uk
RISKY_INVESTOR_WWW_DOMAIN=www.riskyinvestor.co.uk
TRAEFIK_NETWORK=traefik_proxy
TRAEFIK_CERTRESOLVER=letsencrypt
TRAEFIK_ROUTER=risky-investor
TRAEFIK_SERVICE=risky-investor
```

Build and launch:

```bash
docker compose \
  --env-file .env.docker \
  -f compose.yml \
  -f compose.traefik.yml \
  up -d --build
```

No application port is published on the host. Traefik reaches port 4180 over
the shared Docker network.

Verify:

```bash
docker compose \
  --env-file .env.docker \
  -f compose.yml \
  -f compose.traefik.yml \
  ps

curl https://riskyinvestor.co.uk/healthz
```

`/healthz` intentionally contains only a generic service status. All
investment data remains authenticated.

## Existing Traefik installations

Match `.env.docker` to the existing installation:

- `TRAEFIK_NETWORK`: external network shared with Traefik
- `TRAEFIK_ENTRYPOINT`: HTTPS entrypoint, normally `websecure`
- `TRAEFIK_HTTP_ENTRYPOINT`: HTTP entrypoint, normally `web`
- `TRAEFIK_CERTRESOLVER`: configured ACME resolver

The router, service, and middleware names must be unique on that Docker host.

## Versioned images and releases

Docker image tags provide release branches without changing the data volume.
For a registry such as GHCR:

```bash
export IMAGE=ghcr.io/your-account/risky-investor-dashboard
export VERSION=2.1.0
export REVISION="$(git rev-parse --short HEAD)"
export BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

docker build \
  --build-arg APP_VERSION="$VERSION" \
  --build-arg VCS_REF="$REVISION" \
  --build-arg BUILD_DATE="$BUILD_DATE" \
  -t "$IMAGE:$VERSION" \
  -t "$IMAGE:sha-$REVISION" \
  .

docker push "$IMAGE:$VERSION"
docker push "$IMAGE:sha-$REVISION"
```

Set the release in `.env.docker`:

```dotenv
RISKY_INVESTOR_IMAGE=ghcr.io/your-account/risky-investor-dashboard
RISKY_INVESTOR_TAG=2.1.0
APP_VERSION=2.1.0
```

Deploy a published image:

```bash
docker compose --env-file .env.docker -f compose.yml -f compose.traefik.yml pull
docker compose --env-file .env.docker -f compose.yml -f compose.traefik.yml up -d
```

## Rollback

Change `RISKY_INVESTOR_TAG` to the previous immutable version or commit tag,
then run:

```bash
docker compose --env-file .env.docker -f compose.yml -f compose.traefik.yml pull
docker compose --env-file .env.docker -f compose.yml -f compose.traefik.yml up -d
```

The private-data volume remains in place. Take an application backup before
rolling back across a future data-format migration.

## Isolated branch or preview deployment

Create a separate environment file, for example `.env.feature-risk`:

```dotenv
COMPOSE_PROJECT_NAME=risky-investor-feature-risk
RISKY_INVESTOR_IMAGE=ghcr.io/your-account/risky-investor-dashboard
RISKY_INVESTOR_TAG=feature-risk-4f2a1c3
APP_VERSION=feature-risk-4f2a1c3
TRAEFIK_NETWORK=traefik_proxy
TRAEFIK_CERTRESOLVER=letsencrypt
TRAEFIK_ROUTER=risky-investor-feature-risk
TRAEFIK_SERVICE=risky-investor-feature-risk
RISKY_INVESTOR_DOMAIN=feature-risk.riskyinvestor.co.uk
RISKY_INVESTOR_WWW_DOMAIN=feature-risk.riskyinvestor.co.uk
SESSION_TTL_HOURS=12
RISKY_INVESTOR_ROLE=owner
```

Start it with an explicit project name:

```bash
docker compose \
  --env-file .env.feature-risk \
  -p risky-investor-feature-risk \
  -f compose.yml \
  -f compose.traefik.yml \
  up -d
```

Compose project scoping gives that preview its own container, default network,
and private-data volume. Use separate secret files or a separate checkout for
each preview. Never attach a preview branch to the production data volume.

Remove the preview and its disposable volume:

```bash
docker compose \
  --env-file .env.feature-risk \
  -p risky-investor-feature-risk \
  -f compose.yml \
  -f compose.traefik.yml \
  down -v
```

## Private data and backups

The volume name is project-scoped. Inspect it with:

```bash
docker volume ls | grep private-data
```

Use the dashboard's authenticated JSON backup feature for portable,
application-level backups. Also back up the Docker volume and Traefik's
Let's Encrypt volume at the host level.

To inspect logs without exposing data ports:

```bash
docker compose --env-file .env.docker -f compose.yml -f compose.traefik.yml logs -f app
```

To move existing JSON records into Docker, stop the application first and copy
the contents of the existing `data/private` directory into the Compose
private-data volume. Preserve ownership as UID/GID `10001`.

## Operational notes

- Keep the same `COMPOSE_PROJECT_NAME` for normal upgrades so the data volume is reused.
- Use immutable image tags for production; avoid relying on `latest`.
- Back up before image changes, restores, or data migrations.
- Rotate `SESSION_SECRET` to invalidate all existing sessions.
- The container runs without Linux capabilities and with a read-only root filesystem.
- HTTPS is mandatory in production because authentication cookies are secure.

## Configure Discord privately

The application uses the existing `/app/data/private` volume for notification
credentials. No Compose, Traefik, or frontend environment change is required.
Start the application once so the migration-safe credential file is seeded,
then enter the webhook interactively:

```bash
cd /opt/risky-investor
read -rsp "Discord webhook URL: " DISCORD_WEBHOOK
echo
printf '%s' "$DISCORD_WEBHOOK" | docker compose \
  --env-file .env.docker \
  -f compose.yml \
  -f compose.traefik.yml \
  exec -T app node --input-type=module -e '
    import { readFile, rename, writeFile } from "node:fs/promises";
    const file = "/app/data/private/notification_credentials.json";
    let webhook = "";
    for await (const chunk of process.stdin) webhook += chunk;
    webhook = webhook.trim();
    const current = JSON.parse(await readFile(file, "utf8"));
    const temporary = `${file}.tmp`;
    await writeFile(temporary, JSON.stringify({
      ...current,
      version: 1,
      discordWebhookUrl: webhook
    }, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, file);
  '
unset DISCORD_WEBHOOK
```

Do not paste the webhook into a command-line argument, `.env.docker`, a
browser field, a screenshot, or a support log. Restart the app after changing
the credential:

```bash
docker compose \
  --env-file .env.docker \
  -f compose.yml \
  -f compose.traefik.yml \
  restart app
```

Sign in as the owner, open Settings, confirm Discord shows `CONFIGURED`, then
use **Send harmless test**. The response and Alerts history show only delivery
status and the masked webhook ending.

## Duplicate-safe notification migration

Initial deployment preserves legacy scanner delivery:

```text
Scanner:   LEGACY_SCANNER_DISCORD_ENABLED=true
Dashboard: canonicalDashboardDiscordEnabled=false
```

Cut over in a short maintenance window:

1. Back up the dashboard private-data volume and scanner state.
2. Configure and test the dashboard webhook while canonical delivery remains
   disabled.
3. Pause the scanner cron or timer so no live scan can run during the switch.
4. Set `LEGACY_SCANNER_DISCORD_ENABLED=false` in the scanner's existing
   private environment and restart/reload that scanner service.
5. In dashboard Settings, enable Discord and
   **Canonical dashboard Discord**, then save.
6. Run the scanner dry-run and verify one canonical import with no live
   Discord send.
7. Resume the scanner schedule and inspect Alerts delivery history after the
   first live scan.

Rollback is the reverse: pause the scanner schedule, disable canonical
dashboard Discord, set `LEGACY_SCANNER_DISCORD_ENABLED=true`, reload the
scanner, then resume its schedule. Do not leave both senders enabled for a live
scan.

The daily-summary preview in Settings is a dry-run: it renders the canonical
snapshot without contacting Discord or writing a delivery record. Automatic
daily summaries begin only after daily summaries, Discord, and canonical
dashboard delivery are all enabled.
