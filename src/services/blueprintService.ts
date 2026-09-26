import { Guild } from "discord.js";
import { prisma } from "../db/prisma";
import { captureSnapshot } from "./snapshotService";
import { ServerSnapshot } from "../types/snapshot";

export async function saveBlueprint(guild: Guild, name: string, description: string | undefined, creatorId: string) {
  const snapshot = await captureSnapshot(guild);
  const existing = await prisma.blueprint.findUnique({ where: { guildId_name: { guildId: guild.id, name } } });

  if (existing) {
    return prisma.blueprint.update({
      where: { id: existing.id },
      data: {
        description: description ?? existing.description,
        version: existing.version + 1,
        data: JSON.stringify(snapshot),
        creatorId,
      },
    });
  }

  return prisma.blueprint.create({
    data: { guildId: guild.id, name, description, creatorId, data: JSON.stringify(snapshot) },
  });
}

export async function listBlueprints(guildId: string) {
  return prisma.blueprint.findMany({ where: { guildId }, orderBy: { updatedAt: "desc" } });
}

export async function getBlueprint(guildId: string, name: string) {
  return prisma.blueprint.findUnique({ where: { guildId_name: { guildId, name } } });
}

export async function deleteBlueprint(guildId: string, name: string) {
  return prisma.blueprint.delete({ where: { guildId_name: { guildId, name } } }).catch(() => null);
}

export async function renameBlueprint(guildId: string, name: string, newName: string) {
  const existing = await getBlueprint(guildId, name);
  if (!existing) return null;
  return prisma.blueprint.update({ where: { id: existing.id }, data: { name: newName } });
}

export function parseSnapshot(data: string): ServerSnapshot {
  return JSON.parse(data) as ServerSnapshot;
}

/** Spec #16: export a Blueprint as portable JSON text. */
export async function exportBlueprint(guildId: string, name: string): Promise<string | null> {
  const bp = await getBlueprint(guildId, name);
  if (!bp) return null;
  return JSON.stringify(
    {
      exportFormat: "tun-blueprint-v1",
      name: bp.name,
      description: bp.description,
      exportedAt: new Date().toISOString(),
      snapshot: parseSnapshot(bp.data),
    },
    null,
    2
  );
}

export interface ImportedBlueprint {
  name: string;
  description?: string;
  snapshot: ServerSnapshot;
}

/** Spec #16: parses (but does not save) an imported blueprint file for preview. */
export function parseImportedBlueprint(jsonText: string): ImportedBlueprint {
  const parsed = JSON.parse(jsonText);
  if (!parsed.snapshot || !parsed.snapshot.roles || !parsed.snapshot.channels) {
    throw new Error("File does not look like a valid TUN Server Manager blueprint export.");
  }
  return { name: parsed.name ?? "imported-blueprint", description: parsed.description, snapshot: parsed.snapshot };
}

export async function saveImportedBlueprint(guildId: string, imported: ImportedBlueprint, name: string, creatorId: string) {
  return prisma.blueprint.create({
    data: {
      guildId,
      name,
      description: imported.description ?? "Imported blueprint",
      creatorId,
      data: JSON.stringify(imported.snapshot),
    },
  });
}
