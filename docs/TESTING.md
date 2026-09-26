# Test Procedures

Manual QA checklist for a test server before trusting this bot on the real
TUN server. Use a throwaway Discord server, not production, the first time
through.

## Setup

- [ ] `npm install`, `.env` filled in, `npx prisma migrate dev`, `npm run deploy-commands`, `npm run dev`
- [ ] Bot appears online; `/tun help` responds
- [ ] A non-admin account gets a clear "not authorized" message on any `/tun` subcommand
- [ ] `/tun config set-admin-role` grants a role access; that role can now run commands; `/tun config remove-admin-role` revokes it again

## Structure management

- [ ] `/tun category create name:Test` creates a category; `/tun category list` shows it
- [ ] `/tun category rename` / `/tun category move` work and reflect in `/tun category list`
- [ ] `/tun category delete` prompts for confirmation; cancelling leaves it untouched; confirming deletes it and moves child channels to uncategorized (not deleted)
- [ ] `/tun channel create` (each type: text, voice, announcement, forum, stage) succeeds
- [ ] `/tun channel move`, `/tun channel edit` (topic/nsfw/slowmode) work
- [ ] `/tun channel delete` requires confirmation and creates a safety backup first (`/tun backup list` shows a new `auto-safety` entry)

## Roles & permissions

- [ ] `/tun role create`, `/tun role edit`, `/tun role position` work
- [ ] `/tun role delete` requires confirmation
- [ ] Attempting to edit/delete a role **above** the bot's own role returns a clear hierarchy error, not a crash
- [ ] Attempting to edit a **managed** role (e.g. another bot's role) is rejected with a clear message
- [ ] `/tun permission set target:<channel> role:<role> permission:ViewChannel state:deny` creates a Deny overwrite; `/tun permission view` shows it; `state:inherit` clears it back out
- [ ] `/tun permission template save` on a channel with existing overwrites, then `/tun permission template apply` onto a different channel, correctly recreates matching role-based overwrites

## Blueprints

- [ ] `/tun blueprint save name:test1` succeeds; `/tun blueprint list` and `/tun blueprint view name:test1` show it
- [ ] Change something on the server (rename a channel, add a role), then `/tun blueprint compare name:test1` shows the change as a diff **without modifying anything** — re-run `compare` again and confirm nothing changed
- [ ] `/tun blueprint restore name:test1` shows a preview matching the compare output, requires confirmation, and correctly reverts the change on confirm
- [ ] `/tun blueprint restore` with `scope:roles` only touches roles, leaving channel differences alone
- [ ] `/tun blueprint restore` with `delete_extras:true` requires the stronger confirmation button and actually removes extras; without it, extras are left alone
- [ ] `/tun blueprint export name:test1` produces a downloadable `.json`; `/tun blueprint import` on that same file (as a new name) previews correctly and saves
- [ ] `/tun blueprint rename` and `/tun blueprint delete` work and require confirmation for delete

## Backups

- [ ] `/tun backup create label:manual-test` succeeds; `/tun backup list` shows it
- [ ] `/tun backup view` shows correct counts
- [ ] `/tun backup restore` previews and requires confirmation
- [ ] After any destructive command (category/channel/role delete, or a blueprint restore), `/tun backup rollback` correctly reverts to the pre-operation state
- [ ] `/tun backup delete` requires confirmation and only removes the stored record, not live server state

## Safety & audit

- [ ] Every destructive command shows a preview + Confirm/Cancel; clicking Cancel (or letting it time out) makes zero changes
- [ ] `/tun audit view` shows recent actions with user, command, target, timestamp, success/failure
- [ ] Force an error (e.g. try to delete a channel that was already deleted by someone else) and confirm the bot reports a clear error rather than hanging or crashing, and that the audit log records `success: false` with an error message
- [ ] `/tun audit search command:blueprint` and `search user:<someone>` correctly filter results

## Multi-server isolation

- [ ] Invite the bot to a second test server; confirm blueprints/backups/admin config/audit logs from server A do **not** appear in server B
- [ ] Admin authorization configured in server A does not grant access in server B

## Embassy

- [ ] `/tun embassy add` grants the alliance role View/Send access on the channel and appears in `/tun embassy list`
- [ ] `/tun embassy remove` un-registers it (does not automatically revoke the permission overwrite — document this as expected behavior, or manually clear via `/tun permission remove` if desired)

## Deployment

- [ ] `npm run build` completes with no TypeScript errors
- [ ] Local SQLite run works end-to-end per the above
- [ ] Railway deploy: `prisma migrate deploy` runs cleanly against Postgres on first boot, bot comes online, `npm run deploy-commands:global` registers commands within the expected propagation window
