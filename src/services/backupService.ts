import { Guild } from "discord.js";
import { prisma } from "../db/prisma";
import { captureSnapshot } from "./snapshotService";
import { ServerSnapshot } from "../types/snapshot";

export async function createBackup(guild: Guild, label: string, reason: "manual" | "auto-safety" | "rollback-point", creatorId: string) {
  const snapshot = await captureSnapshot(guild);
  return prisma.backup.create({
    data: { guildId: guild.id, label, reason, creatorId, data: JSON.stringify(snapshot) },
  });
}

export async function listBackups(guildId: string, limit = 20) {
  return prisma.backup.findMany({ where: { guildId }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function getBackup(guildId: string, id: string) {
  return prisma.backup.findFirst({ where: { guildId, id } });
}

export async function deleteBackup(guildId: string, id: string) {
  const bk = await getBackup(guildId, id);
  if (!bk) return null;
  await prisma.backup.delete({ where: { id: bk.id } });
  return bk;
}

export function parseBackupSnapshot(data: string): ServerSnapshot {
  return JSON.parse(data) as ServerSnapshot;
}

/**
 * Spec #9/#10: before any major destructive operation, automatically create
 * a safety backup so the operation itself is recoverable via rollback.
 */
export async function createSafetyBackup(guild: Guild, creatorId: string, reasonLabel: string) {
  return createBackup(guild, `auto-safety: ${reasonLabel}`, "auto-safety", creatorId);
}

/** Returns the most recent auto-safety backup, used by /tun backup rollback. */
export async function getLatestSafetyBackup(guildId: string) {
  return prisma.backup.findFirst({
    where: { guildId, reason: { in: ["auto-safety", "rollback-point"] } },
    orderBy: { createdAt: "desc" },
  });
}
