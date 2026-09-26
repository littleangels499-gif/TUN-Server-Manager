# Blueprints & Backups

Both systems store the exact same shape of data — a `ServerSnapshot`
(`src/types/snapshot.ts`): roles, categories, channels, and their
permission overwrites. They differ only in **intent**:

| | Blueprint | Backup |
|---|---|---|
| Purpose | A named "design" you deliberately maintain and can restore to | A disaster-recovery point-in-time snapshot |
| Created | Manually, via `/tun blueprint save` | Manually (`/tun backup create`) or automatically before destructive operations |
| Typical use | "Make the server match this design" | "Undo what just happened" |

## Name-based matching — read this before restoring anything

Roles, categories, and channels are matched **by name**, not by Discord's
internal ID, whenever comparing or restoring. This is deliberate:

- It's what makes blueprints **portable** — you can export one and import
  it into a different server (spec §16), where the IDs would never match.
- It survives a channel being deleted and recreated with the same name.

**The consequence:** if you rename something on the live server, the next
`compare` or `restore` will see that as **one delete + one create**, not
a rename. If you want a rename to be recognized as the same object,
rename it back to match the blueprint, or re-save the blueprint after the
rename.

## What gets captured (and what doesn't)

Captured: category/channel names, types, positions, parent relationships,
topics, NSFW flags, slowmode, voice bitrate/user limit, role names,
colors, hoist/mentionable flags, permissions, positions, and all role/user
permission overwrites on categories and channels.

**Not captured** (Discord API/platform limitations — see
[API_LIMITATIONS.md](API_LIMITATIONS.md)): message history, invites,
webhooks, AutoMod rules, welcome screen, server icon/banner, boost-perk
state, verification/2FA level. This note is embedded in every
snapshot's `unsupportedNote` field.

## Restore behavior

`/tun blueprint restore` and `/tun backup restore` (and `/tun backup
rollback`, which restores the most recent automatic safety backup):

1. **Always show a preview first** — a diff of what would change,
   computed by `src/services/diffService.ts`. Nothing happens until you
   click **Confirm**.
2. **Are additive/corrective by default**: missing items are created,
   changed items are updated. Items that exist live but aren't in the
   target snapshot are **left alone**, unless you explicitly pass
   `delete_extras: true` (blueprint restore only), which requires the
   stronger "Yes, I understand" confirmation button (spec §12: "extremely
   destructive operations may require stronger confirmation").
3. **Always take an automatic safety backup first** (spec #9), tagged
   `reason: "auto-safety"` or `"rollback-point"`, so a bad restore can
   itself be undone with `/tun backup rollback`.
4. **Support partial scope** (spec #17): `scope: categories | channels |
   roles | full` restricts what's touched.
5. **Respect role hierarchy** — roles the bot can't touch are skipped and
   reported, never silently ignored (see API_LIMITATIONS.md).
6. **Are throttled** — bulk changes are deliberately spaced out to stay
   under Discord's per-channel edit rate limits. A large restore will take
   noticeably longer than instant; this is intentional.

## Import / export

`/tun blueprint export` produces a `.json` file in the
`tun-blueprint-v1` format (see `blueprints/tun-current.blueprint.json`
for an example/starter file). `/tun blueprint import` reads that same
format, shows a preview diff against the live server, and — only on
confirmation — **saves** it as a new blueprint. Importing never touches
your live server by itself; you still need to run `/tun blueprint
restore` afterward if you want to apply it.

## Rollback vs restore

- `/tun backup restore` restores a *specific* backup you choose by ID.
- `/tun backup rollback` is a shortcut: it always targets the most recent
  automatic safety backup, i.e. "undo the last major operation I did."
  If no safety backup exists yet (e.g. this is the very first destructive
  action ever run), rollback will tell you so rather than guessing.
