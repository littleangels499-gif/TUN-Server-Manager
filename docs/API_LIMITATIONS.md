# Discord API Limitations

Spec §23 requires this to be documented explicitly. Everything below is a
**hard platform limitation**, not a bug in this bot. Where relevant, the
note explains how TUN Server Manager fails safely around it.

## Role hierarchy

- A bot can only create, edit, delete or reposition roles that sit **below
  its own highest role**. It can never touch a role at or above its own
  position, and never the server owner's roles.
- A bot can never assign a role higher than its own top role to anyone.
- **How this bot handles it:** `role.ts` and `restoreService.ts` check
  hierarchy before attempting a change and return a clear error
  ("Move the bot's role higher in Server Settings → Roles") instead of
  letting the Discord API call fail opaquely. During a blueprint/backup
  restore, any role that can't be touched is skipped and reported in the
  result summary (`rolesSkipped`), not silently dropped.

## Server ownership

- Ownership cannot be transferred, viewed as transferable, or acted on via
  a bot at all. Not modeled by this bot in any way.

## Managed (integration) roles

- Roles created by bot integrations (including this bot's own role) and
  the Nitro Booster role are **managed** — no bot, including this one, can
  edit, delete, or reposition them.
- **How this bot handles it:** these are captured in snapshots as
  read-only/informational and are never targeted for restore; `role.ts`
  explicitly rejects operations on managed roles with a clear message.

## Hard numeric caps (as of writing — verify current values in Discord's docs if a restore fails near these numbers)

| Resource | Limit |
|---|---|
| Roles per server | 250 (managed roles like bot/booster roles can push slightly over) |
| Channels per server | 500 by default |
| Emoji | 50 static / 50 animated (more at higher boost levels) |

A full-structure restore that would exceed these caps will fail partway
through with Discord API errors, which are captured per-item in
`RestoreResult.errors` rather than aborting the whole operation silently.

## Rate limits

- **Global:** ~50 requests/second across the whole bot connection.
- **Per-route:** each endpoint (e.g. channel edit, role create) has its
  own bucket. The most relevant one here: **channel name/topic edits are
  limited to roughly 2 changes per 10 minutes per channel** — this is
  aggressively enforced to prevent raid/abuse patterns.
- **How this bot handles it:** all bulk operations (blueprint/backup
  restore) go through `src/utils/throttle.ts`, which spaces out calls
  (700–900ms apart) rather than firing everything at once. This is
  intentionally conservative — a big restore will take noticeably longer
  than the theoretical minimum, in exchange for not silently stalling or
  getting individual operations rejected. If a restore does hit a
  per-channel edit limit (e.g. because you already edited that channel
  moments ago), the specific failure is reported, not swallowed.

## Community-server-only / unavailable settings

The following either require **Community** to be enabled on the server,
or are not exposed to bots via the API at all, and are therefore **not**
captured or restorable by this bot:

- Rules/guidelines channel designation, Community welcome screen
- AutoMod rules
- Server verification level, explicit content filter level
- Two-factor authentication requirement for moderation actions
- Vanity invite URL
- Server icon, banner, splash, and discovery images
- Boost perk state (this is derived from the server's boost count, not settable)
- Webhooks and their configured content
- Message history of any channel

See `UNSUPPORTED_PROPERTIES_NOTE` in `src/types/snapshot.ts` — this same
text is embedded in every snapshot's `unsupportedNote` field, so it's
visible directly in any exported blueprint/backup JSON as well.

## Audit log retention

Discord's own built-in audit log reliably retains roughly the last **45
days** of entries and is not something a bot can extend. TUN Server
Manager does **not** rely on reading Discord's audit log — it writes its
own `AuditLog` table at the moment each command runs (spec §13), so the
bot's own history has no such expiry.

## Failing safely

Every command in this bot:
1. Wraps its body in `safeExecute()` (`src/utils/commandHelpers.ts`), so any
   Discord API rejection becomes a clear, user-facing error message and a
   `success: false` audit log entry — never a silent failure or a hung
   interaction.
2. Never assumes an operation succeeded before proceeding to the next step
   in a multi-part operation (e.g. restore) — errors on individual items
   are collected and reported, not treated as fatal to the whole batch.
