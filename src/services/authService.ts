import { GuildMember, PermissionFlagsBits } from "discord.js";
import { prisma } from "../db/prisma";
import { botOwnerIds } from "../config";

/** Ensures a Guild row exists before anything else touches it. */
export async function ensureGuild(guildId: string, name?: string) {
  return prisma.guild.upsert({
    where: { id: guildId },
    update: name ? { name } : {},
    create: { id: guildId, name },
  });
}

export async function getAdminConfig(guildId: string) {
  const guild = await ensureGuild(guildId);
  return {
    adminRoleIds: JSON.parse(guild.adminRoleIds) as string[],
    adminUserIds: JSON.parse(guild.adminUserIds) as string[],
  };
}

export async function addAdminRole(guildId: string, roleId: string) {
  const { adminRoleIds } = await getAdminConfig(guildId);
  if (!adminRoleIds.includes(roleId)) adminRoleIds.push(roleId);
  await prisma.guild.update({ where: { id: guildId }, data: { adminRoleIds: JSON.stringify(adminRoleIds) } });
}

export async function removeAdminRole(guildId: string, roleId: string) {
  const { adminRoleIds } = await getAdminConfig(guildId);
  const next = adminRoleIds.filter((id) => id !== roleId);
  await prisma.guild.update({ where: { id: guildId }, data: { adminRoleIds: JSON.stringify(next) } });
}

export async function addAdminUser(guildId: string, userId: string) {
  const { adminUserIds } = await getAdminConfig(guildId);
  if (!adminUserIds.includes(userId)) adminUserIds.push(userId);
  await prisma.guild.update({ where: { id: guildId }, data: { adminUserIds: JSON.stringify(adminUserIds) } });
}

export async function removeAdminUser(guildId: string, userId: string) {
  const { adminUserIds } = await getAdminConfig(guildId);
  const next = adminUserIds.filter((id) => id !== userId);
  await prisma.guild.update({ where: { id: guildId }, data: { adminUserIds: JSON.stringify(next) } });
}

/**
 * Spec #14: powerful commands restricted to configurable authorized admins
 * (native Discord Administrator permission, and/or designated roles/users
 * configured per server via /tun config).
 */
export async function isAuthorizedAdmin(member: GuildMember): Promise<boolean> {
  if (botOwnerIds.includes(member.id)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const { adminRoleIds, adminUserIds } = await getAdminConfig(member.guild.id);
  if (adminUserIds.includes(member.id)) return true;
  if (member.roles.cache.some((r) => adminRoleIds.includes(r.id))) return true;

  return false;
}
