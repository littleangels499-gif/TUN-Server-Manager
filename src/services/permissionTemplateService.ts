import { prisma } from "../db/prisma";
import { PermissionOverwriteSnapshot } from "../types/snapshot";

/**
 * A template captures a full set of role/member permission overwrites -
 * i.e. "the overwrite pattern of this channel" - so it can be copy-applied
 * onto other categories/channels. Subjects are matched by NAME within the
 * target guild when applied (same convention as blueprints/backups).
 */
export type TemplateEntry = PermissionOverwriteSnapshot;

export async function saveTemplate(guildId: string, name: string, creatorId: string, entries: TemplateEntry[]) {
  return prisma.permissionTemplate.upsert({
    where: { guildId_name: { guildId, name } },
    update: { data: JSON.stringify(entries), creatorId },
    create: { guildId, name, creatorId, data: JSON.stringify(entries) },
  });
}

export async function getTemplate(guildId: string, name: string) {
  const row = await prisma.permissionTemplate.findUnique({ where: { guildId_name: { guildId, name } } });
  if (!row) return null;
  return { ...row, entries: JSON.parse(row.data) as TemplateEntry[] };
}

export async function listTemplates(guildId: string) {
  return prisma.permissionTemplate.findMany({ where: { guildId }, orderBy: { name: "asc" } });
}

export async function deleteTemplate(guildId: string, name: string) {
  return prisma.permissionTemplate.delete({ where: { guildId_name: { guildId, name } } }).catch(() => null);
}
