# TUN Server Manager

A Discord bot for authorized TUN administrators to manage server structure,
roles and permissions; save/restore configurations as **Blueprints**;
compare live servers against saved configs; and back up / recover from
mistakes via a dedicated **Backup** system.

Built with Node.js, TypeScript, discord.js v14, and Prisma (SQLite by
default, Postgres-ready).

---

## 1. Before you start: things to know

- **This was written without the ability to `npm install` or compile it
  first** (no network access in the build environment). The code follows
  discord.js v14's documented APIs carefully, but the very first thing you
  should do is `npm install` and `npm run build` and fix any TypeScript
  errors that surface — see [Troubleshooting](#7-troubleshooting) if you
  hit any.
- Every destructive command (delete, restore, rollback, import) shows a
  preview and requires you to click **Confirm** before anything happens.
- The bot never touches message content and doesn't request the
  Message Content privileged intent — it only manages structure.

---

## 2. Create the Discord application & bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → name it (e.g. "TUN Server Manager").
2. Go to **Bot** in the sidebar → **Add Bot**.
   - Under **Privileged Gateway Intents**, enable **Server Members Intent**. You do NOT need Message Content or Presence intents.
   - Click **Reset Token** and copy it — this is your `DISCORD_TOKEN`. Keep it secret; anyone with it controls your bot.
3. Go to **General Information** and copy the **Application ID** — this is your `DISCORD_CLIENT_ID`.
4. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions (minimum to use every command in this spec): `Manage Channels`, `Manage Roles`, `View Channels`, `Manage Server` (Manage Server isn't strictly required but is often useful for future features — leave it out if you want to be conservative). Copy the generated URL and open it to invite the bot to your server.
5. **Role position matters:** after inviting the bot, go to Server Settings → Roles and drag the bot's role **above every role you want it to manage**. Discord will not let a bot create, edit, delete or reposition any role at or above its own highest role — see [docs/API_LIMITATIONS.md](docs/API_LIMITATIONS.md).

---

## 3. Run it locally (VS Code)

```bash
# 1. Open the tun-server-manager folder in VS Code, then in its integrated terminal:
npm install

# 2. Copy the env template and fill in your values
cp .env.example .env
# Edit .env: paste DISCORD_TOKEN, DISCORD_CLIENT_ID, and (recommended for dev) DEV_GUILD_ID
#   DEV_GUILD_ID = the server ID you're testing in (right-click server icon → Copy Server ID,
#   requires Developer Mode on in Discord settings). Guild-scoped commands update instantly;
#   global commands can take up to ~1 hour to appear.

# 3. Create the local SQLite database and tables
mkdir -p data
npx prisma migrate dev --name init

# 4. Register the /tun command to your dev server
npm run deploy-commands

# 5. Start the bot (auto-restarts on file changes)
npm run dev
```

If everything worked, your bot should show as online, and `/tun help`
should appear when you type `/` in your test server.

**First thing to do on a fresh server:** run `/tun config set-admin-role`
(or `set-admin-user`) to authorize yourself, unless you already have the
native Discord **Administrator** permission (which is always allowed).

---

## 4. Project structure

```
prisma/schema.prisma       Database schema (Guild, Blueprint, Backup, AuditLog, EmbassyChannel, PermissionTemplate)
blueprints/                Portable blueprint JSON files (config data, not code)
src/
  index.ts                 Bot entry point / interaction router
  deploy-commands.ts       Registers the /tun command with Discord
  config.ts, logger.ts     Env loading, logging
  db/prisma.ts             Prisma client singleton
  discord/client.ts        Discord client + intents
  types/snapshot.ts         The "ServerSnapshot" shape shared by blueprints & backups
  services/                 All business logic (auth, audit, snapshot capture,
                             diff engine, restore engine, blueprint/backup CRUD,
                             permission templates, embassies)
  commands/                 One file per /tun subcommand GROUP, plus the registry (index.ts)
  utils/                    Embeds, confirm-button flow, throttled bulk ops, helpers
docs/                       API limitations, blueprint/backup guide, test procedures
```

Design principle carried through the whole codebase (spec §2, §22): the
current TUN server structure is **data** (`blueprints/tun-current.blueprint.json`),
never hardcoded into the application. Roles/categories/channels are matched
**by name**, not Discord ID, when comparing or restoring — this is what
makes blueprints portable across servers and survives channels being
deleted and recreated.

---

## 5. Deploying to Railway

1. Push this folder to a GitHub repo (private is fine).
2. In Railway: **New Project → Deploy from GitHub repo**, pick the repo.
3. **Add a Postgres database**: New → Database → PostgreSQL (recommended for production — see [Switching to Postgres](#6-switching-to-postgres) below; you can also stay on SQLite for a single small server, but Railway's filesystem is ephemeral on redeploy unless you attach a Volume).
4. In your service's **Variables** tab, set:
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`
   - `DATABASE_URL` — if you added Railway Postgres, reference it as `${{Postgres.DATABASE_URL}}`
   - Do **not** set `DEV_GUILD_ID` in production — leaving it unset means `npm run start` should still register commands globally *only if you run* `npm run deploy-commands:global` once (see below); the bot itself doesn't auto-register on boot by design, so registration is a deliberate, explicit step.
   - `LOG_LEVEL=info`
5. Railway will run `npm run build` (via `railway.json`) then `npm run start`, which runs `prisma migrate deploy` before starting the bot.
6. **Register commands globally** (one-time, or whenever the command list changes): from your local machine with the same `DISCORD_TOKEN`/`DISCORD_CLIENT_ID` in `.env` (and no `DEV_GUILD_ID`), run:
   ```bash
   npm run deploy-commands:global
   ```
   Global commands can take up to ~1 hour to appear in all servers.

---

## 6. Switching to Postgres

The schema defaults to SQLite. To use Postgres (recommended once you have
more than one server, per spec §19):

1. Open `prisma/schema.prisma` and change:
   ```prisma
   datasource db {
     provider = "postgresql"   // was "sqlite"
     url      = env("DATABASE_URL")
   }
   ```
2. Set `DATABASE_URL` to your Postgres connection string (Railway gives you one automatically if you add a Postgres plugin).
3. Delete `prisma/migrations/` (SQLite and Postgres migrations aren't interchangeable) and run:
   ```bash
   npx prisma migrate dev --name init_postgres
   ```
4. Everything else (services, commands) is unchanged — Prisma abstracts the rest.

---

## 7. Troubleshooting

- **"Invalid or missing environment variables"** — you haven't filled in `.env`, or forgot to `cp .env.example .env`.
- **Slash commands don't show up** — guild-scoped registration (`DEV_GUILD_ID` set) is instant; global registration can take up to an hour. Also confirm the bot was invited with the `applications.commands` scope.
- **"Discord will not let the bot modify" a role** — move the bot's own role higher in Server Settings → Roles. This is a hard Discord API limitation, not a bug — see [docs/API_LIMITATIONS.md](docs/API_LIMITATIONS.md).
- **A blueprint/backup restore seems slow** — this is intentional. Bulk structural changes are throttled (see `src/utils/throttle.ts`) to stay well under Discord's per-channel rate limits (roughly 2 name/topic edits per 10 minutes per channel) so a big restore doesn't get silently stalled or rejected mid-way.
- **TypeScript errors on first build** — this project was authored without a live compiler to check against. Most likely culprits are discord.js option-type mismatches on channel creation (e.g. voice-specific vs text-specific fields); check `src/services/restoreService.ts` and `src/commands/channel.ts` first if you hit anything.

---

## 8. Further documentation

- [docs/API_LIMITATIONS.md](docs/API_LIMITATIONS.md) — what Discord does not allow bots to do, and how this bot fails safely around those limits.
- [docs/BLUEPRINTS_AND_BACKUPS.md](docs/BLUEPRINTS_AND_BACKUPS.md) — how the blueprint/backup/restore/rollback system works, name-based matching, what is and isn't captured.
- [docs/TESTING.md](docs/TESTING.md) — manual test procedures for create/save/modify/compare/backup/restore/rollback workflows.
- Required Discord bot permissions: `Manage Channels`, `Manage Roles`, `View Channels` (see §2 above).
- In-app documentation: `/tun help` (with an optional `category` option for `structure`, `roles`, `permissions`, `blueprints`, `backups`, `safety`, `administration`).
