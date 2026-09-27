import { ChannelType, Guild, OverwriteType, PermissionsBitField } from "discord.js";
import { PermissionOverwriteSnapshot, ServerSnapshot } from "../types/snapshot";
import { diffSnapshots } from "./diffService";
import { captureSnapshot } from "./snapshotService";
import { runThrottled } from "../utils/throttle";

export type RestoreScope = "full" | "categories" | "channels" | "roles";

export interface RestoreOptions {
  guild: Guild;
  target: ServerSnapshot;
  /** Spec #17: allow restoring only specific component types. */
  scope: RestoreScope;
  /** If false (dry-run), compute what WOULD happen but touch nothing. */
  apply: boolean;
  onProgress?: (message: string) => void;
}

export interface RestoreResult {
  rolesCreated: string[];
  rolesUpdated: string[];
  rolesSkipped: { name: string; reason: string }[];
  everyoneUpdated: boolean;
  categoriesCreated: string[];
  categoriesUpdated: string[];
  channelsCreated: string[];
  channelsUpdated: string[];
  /** Overwrite subjects (role/member names) referenced by a blueprint that
   *  don't exist on the target server, so their overwrite entry was skipped
   *  rather than silently dropped or crashing the whole restore. */
  overwritesSkipped: string[];
  errors: { item: string; error: string }[];
}

function bitfieldFromString(v: string): bigint {
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

function channelTypeFromName(name: string): ChannelType {
  const map: Record<string, ChannelType> = {
    GuildText: ChannelType.GuildText,
    GuildVoice: ChannelType.GuildVoice,
    GuildAnnouncement: ChannelType.GuildAnnouncement,
    GuildStageVoice: ChannelType.GuildStageVoice,
    GuildForum: ChannelType.GuildForum,
  };
  return map[name] ?? ChannelType.GuildText;
}

/**
 * Resolves a blueprint/backup's stored overwrite subjects (captured as
 * NAMES - see types/snapshot.ts) against the actual roles/members present
 * on the target guild right now. A subject that can't be found (a role
 * that doesn't exist on this server, a member who's left) is reported in
 * `skipped`, not silently dropped and not treated as fatal.
 */
function resolveOverwrites(
  guild: Guild,
  overwrites: PermissionOverwriteSnapshot[]
): { resolved: { id: string; type: OverwriteType; allow: bigint; deny: bigint }[]; skipped: string[] } {
  const resolved: { id: string; type: OverwriteType; allow: bigint; deny: bigint }[] = [];
  const skipped: string[] = [];

  for (const ow of overwrites) {
    let id: string | undefined;

    if (ow.targetType === "role") {
      id =
        ow.targetName === "@everyone"
          ? guild.id
          : guild.roles.cache.find((r) => r.name.toLowerCase() === ow.targetName.toLowerCase())?.id;
    } else {
      id = guild.members.cache.find((m) => m.user.tag.toLowerCase() === ow.targetName.toLowerCase())?.id;
    }

    if (!id) {
      skipped.push(ow.targetName);
      continue;
    }

    resolved.push({
      id,
      type: ow.targetType === "role" ? OverwriteType.Role : OverwriteType.Member,
      allow: bitfieldFromString(ow.allow),
      deny: bitfieldFromString(ow.deny),
    });
  }

  return { resolved, skipped };
}

/**
 * Applies `target` onto `guild`. This is intentionally ADDITIVE/CORRECTIVE
 * by default (creates missing items, fixes changed properties) and does
 * NOT delete extra live items unless the caller explicitly wants a
 * destructive full sync - see commands/blueprint.ts "repair" flow, which
 * asks separately before deleting anything. This matches spec #7's
 * "repair/synchronization workflow after preview and confirmation" while
 * keeping delete as an explicit, separately-confirmed step.
 *
 * Role hierarchy (a hard Discord API limitation): the bot can only create/
 * edit roles below its own highest role. Any role in the target that would
 * need to sit above the bot's top role is SKIPPED, not silently dropped -
 * it is reported back in `rolesSkipped` so the admin can act (e.g. move the
 * bot's role up).
 *
 * Permission overwrites (who can see/use each category/channel) are fully
 * re-applied on both create and update, resolving each stored role/member
 * NAME against the target server (see resolveOverwrites above) - this is
 * what makes a full "recreate this server, roles/permissions included"
 * restore actually work end to end, not just recreate empty channels.
 */
export async function applyRestore(opts: RestoreOptions): Promise<RestoreResult> {
  const { guild, target, scope, apply, onProgress } = opts;
  const result: RestoreResult = {
    rolesCreated: [],
    rolesUpdated: [],
    rolesSkipped: [],
    everyoneUpdated: false,
    categoriesCreated: [],
    categoriesUpdated: [],
    channelsCreated: [],
    channelsUpdated: [],
    overwritesSkipped: [],
    errors: [],
  };

  const botMember = await guild.members.fetchMe();
  const botTopPosition = botMember.roles.highest.position;

  const live = await captureSnapshot(guild);
  const diff = diffSnapshots(live, target); // "from"=live, "to"=target -> added/changed relative to live

  // ---- Roles (including @everyone's base permissions) ----
  if (scope === "full" || scope === "roles") {
    if (apply && target.everyonePermissions !== null && diff.everyoneChanged) {
      try {
        await guild.roles.everyone.setPermissions(
          new PermissionsBitField(bitfieldFromString(target.everyonePermissions)),
          "TUN Server Manager restore"
        );
        result.everyoneUpdated = true;
      } catch (err: any) {
        result.errors.push({ item: "@everyone base permissions", error: err?.message ?? "unknown error" });
      }
    } else if (!apply && diff.everyoneChanged) {
      onProgress?.("[dry-run] would update @everyone base permissions");
    }

    const roleTasks = [...diff.roles.added, ...diff.roles.changed];
    await runThrottled(
      roleTasks,
      async (entry) => {
        const targetRole = entry.item;
        const existing = guild.roles.cache.find((r) => r.name.toLowerCase() === targetRole.name.toLowerCase());

        if (!apply) {
          onProgress?.(`[dry-run] would ${existing ? "update" : "create"} role "${targetRole.name}"`);
          return;
        }

        if (existing) {
          if (existing.position >= botTopPosition && !existing.editable) {
            result.rolesSkipped.push({ name: targetRole.name, reason: "role is above the bot's highest role (hierarchy limit)" });
            return;
          }
          await existing.edit({
            color: targetRole.color,
            hoist: targetRole.hoist,
            mentionable: targetRole.mentionable,
            permissions: new PermissionsBitField(bitfieldFromString(targetRole.permissions)),
            reason: "TUN Server Manager restore",
          });
          result.rolesUpdated.push(targetRole.name);
        } else {
          const created = await guild.roles.create({
            name: targetRole.name,
            color: targetRole.color,
            hoist: targetRole.hoist,
            mentionable: targetRole.mentionable,
            permissions: new PermissionsBitField(bitfieldFromString(targetRole.permissions)),
            reason: "TUN Server Manager restore",
          });
          result.rolesCreated.push(created.name);
        }
      },
      { delayMs: 700, onProgress: (d, t) => onProgress?.(`Roles: ${d}/${t}`) }
    );
  }

  // ---- Categories ----
  const categoryIdByName = new Map<string, string>();
  for (const c of guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).values()) {
    categoryIdByName.set(c.name.toLowerCase(), c.id);
  }

  if (scope === "full" || scope === "categories") {
    const catTasks = [...diff.categories.added, ...diff.categories.changed];
    await runThrottled(
      catTasks,
      async (entry) => {
        const targetCat = entry.item;
        const existingId = categoryIdByName.get(targetCat.name.toLowerCase());
        const { resolved, skipped } = resolveOverwrites(guild, targetCat.overwrites);
        result.overwritesSkipped.push(...skipped);

        if (!apply) {
          onProgress?.(`[dry-run] would ${existingId ? "update" : "create"} category "${targetCat.name}"`);
          return;
        }

        if (existingId) {
          const ch = await guild.channels.fetch(existingId);
          if (ch) {
            await (ch as any).setPosition(targetCat.position).catch(() => undefined);
            await (ch as any).permissionOverwrites
              .set(
                resolved.map((r) => ({ id: r.id, type: r.type, allow: r.allow, deny: r.deny })),
                "TUN Server Manager restore"
              )
              .catch((err: any) => result.errors.push({ item: `${targetCat.name} overwrites`, error: err?.message ?? "unknown error" }));
            result.categoriesUpdated.push(targetCat.name);
          }
        } else {
          const created = await guild.channels.create({
            name: targetCat.name,
            type: ChannelType.GuildCategory,
            permissionOverwrites: resolved.map((r) => ({ id: r.id, type: r.type, allow: r.allow, deny: r.deny })),
            reason: "TUN Server Manager restore",
          });
          categoryIdByName.set(created.name.toLowerCase(), created.id);
          result.categoriesCreated.push(created.name);
        }
      },
      { delayMs: 800, onProgress: (d, t) => onProgress?.(`Categories: ${d}/${t}`) }
    );
  }

  // ---- Channels ----
  if (scope === "full" || scope === "channels") {
    const chanTasks = [...diff.channels.added, ...diff.channels.changed];
    await runThrottled(
      chanTasks,
      async (entry) => {
        const targetCh = entry.item;
        const existing = guild.channels.cache.find(
          (c) => c.name.toLowerCase() === targetCh.name.toLowerCase() && c.type !== ChannelType.GuildCategory
        );
        const parentId = targetCh.parentName ? categoryIdByName.get(targetCh.parentName.toLowerCase()) : undefined;
        const { resolved, skipped } = resolveOverwrites(guild, targetCh.overwrites);
        result.overwritesSkipped.push(...skipped);

        if (!apply) {
          onProgress?.(`[dry-run] would ${existing ? "update" : "create"} channel "${targetCh.name}"`);
          return;
        }

        if (existing && "setTopic" in existing) {
          // NOTE: Discord limits name/topic edits to ~2 per 10 min per
          // channel - the throttle delay above is intentionally spaced out,
          // but a very large restore may still need to be re-run if this
          // route gets rate-limited; errors are captured, not fatal.
          const anyExisting = existing as any;
          if (parentId && anyExisting.parentId !== parentId) await anyExisting.setParent(parentId).catch(() => undefined);
          if (typeof targetCh.topic === "string" && "topic" in anyExisting) {
            await anyExisting.setTopic(targetCh.topic).catch(() => undefined);
          }
          if ("nsfw" in anyExisting) await anyExisting.setNSFW(targetCh.nsfw).catch(() => undefined);
          await anyExisting.permissionOverwrites
            .set(
              resolved.map((r) => ({ id: r.id, type: r.type, allow: r.allow, deny: r.deny })),
              "TUN Server Manager restore"
            )
            .catch((err: any) => result.errors.push({ item: `${targetCh.name} overwrites`, error: err?.message ?? "unknown error" }));
          result.channelsUpdated.push(targetCh.name);
        } else if (!existing) {
          const created = await guild.channels.create({
            name: targetCh.name,
            type: channelTypeFromName(targetCh.type) as any,
            parent: parentId,
            topic: targetCh.topic ?? undefined,
            nsfw: targetCh.nsfw,
            permissionOverwrites: resolved.map((r) => ({ id: r.id, type: r.type, allow: r.allow, deny: r.deny })),
            reason: "TUN Server Manager restore",
          });
          result.channelsCreated.push(created.name);
        }
      },
      { delayMs: 900, onProgress: (d, t) => onProgress?.(`Channels: ${d}/${t}`) }
    );
  }

  return result;
}
