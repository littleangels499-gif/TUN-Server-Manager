import { CategoryChannel, ChannelType, Guild, PermissionOverwrites } from "discord.js";
import {
  CategorySnapshot,
  ChannelSnapshot,
  PermissionOverwriteSnapshot,
  RoleSnapshot,
  SNAPSHOT_VERSION,
  ServerSnapshot,
  UNSUPPORTED_PROPERTIES_NOTE,
} from "../types/snapshot";

function mapOverwrites(overwrites: ReadonlyMap<string, PermissionOverwrites>): PermissionOverwriteSnapshot[] {
  const result: PermissionOverwriteSnapshot[] = [];
  for (const ow of overwrites.values()) {
    const isRole = ow.type === 0; // OverwriteType.Role
    const guild = (ow as any).guild as Guild | undefined;
    let targetName = ow.id;
    if (isRole) {
      targetName = guild?.roles.cache.get(ow.id)?.name ?? ow.id;
    } else {
      targetName = guild?.members.cache.get(ow.id)?.user.tag ?? ow.id;
    }
    result.push({
      targetType: isRole ? "role" : "member",
      targetName,
      targetId: ow.id,
      allow: ow.allow.bitfield.toString(),
      deny: ow.deny.bitfield.toString(),
    });
  }
  return result;
}

/** Captures the current, supported structure of a guild (spec #6, #8). */
export async function captureSnapshot(guild: Guild): Promise<ServerSnapshot> {
  // Make sure caches are fresh - roles/channels are gateway-cached already
  // via the Guilds intent, but fetch defensively in case of a cold cache.
  await guild.roles.fetch();
  const channels = await guild.channels.fetch();

  const roles: RoleSnapshot[] = guild.roles.cache
    .filter((r) => r.id !== guild.id) // exclude @everyone from role list (handled separately if ever needed)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      position: r.position,
      managed: r.managed,
      icon: r.icon ?? null,
    }))
    .sort((a, b) => b.position - a.position);

  const categories: CategorySnapshot[] = [];
  const channelSnapshots: ChannelSnapshot[] = [];

  for (const ch of channels.values()) {
    if (!ch) continue;
    if (ch.type === ChannelType.GuildCategory) {
      const cat = ch as CategoryChannel;
      categories.push({
        id: cat.id,
        name: cat.name,
        position: cat.position,
        overwrites: mapOverwrites(cat.permissionOverwrites.cache),
      });
      continue;
    }

    // Skip channel types we don't manage structurally (e.g. directory).
    if (
      ch.type === ChannelType.GuildText ||
      ch.type === ChannelType.GuildVoice ||
      ch.type === ChannelType.GuildAnnouncement ||
      ch.type === ChannelType.GuildStageVoice ||
      ch.type === ChannelType.GuildForum
    ) {
      const anyCh = ch as any;
      channelSnapshots.push({
        id: ch.id,
        name: ch.name,
        type: ChannelType[ch.type],
        parentName: anyCh.parent?.name ?? null,
        position: anyCh.position ?? 0,
        topic: anyCh.topic ?? null,
        nsfw: anyCh.nsfw ?? false,
        rateLimitPerUser: anyCh.rateLimitPerUser ?? null,
        bitrate: anyCh.bitrate ?? null,
        userLimit: anyCh.userLimit ?? null,
        overwrites: mapOverwrites(anyCh.permissionOverwrites?.cache ?? new Map()),
      });
    }
  }

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    guildId: guild.id,
    guildName: guild.name,
    roles,
    categories,
    channels: channelSnapshots,
    unsupportedNote: UNSUPPORTED_PROPERTIES_NOTE,
  };
}
