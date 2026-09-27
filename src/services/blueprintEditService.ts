import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { prisma } from "../db/prisma";
import { getBlueprint } from "./blueprintService";
import {
  CategorySnapshot,
  ChannelSnapshot,
  createEmptySnapshot,
  PermissionOverwriteSnapshot,
  RoleSnapshot,
  ServerSnapshot,
} from "../types/snapshot";
import { isValidPermissionName } from "../utils/permissionsList";

/**
 * This whole file exists so a blueprint can be DESIGNED entirely through
 * bot commands - no live server required at all. Every function here reads
 * a blueprint's stored snapshot JSON, mutates it in memory, and writes it
 * straight back to the database. Nothing here ever touches Discord's API.
 * The result is a normal blueprint like any other - it can be viewed,
 * compared, exported, or restored onto any server exactly the same way as
 * a blueprint captured with `/tun blueprint save`.
 */

export async function createEmptyBlueprint(guildId: string, name: string, description: string | undefined, creatorId: string) {
  const existing = await getBlueprint(guildId, name);
  if (existing) throw new Error(`A blueprint named "${name}" already exists. Choose a different name, or delete the existing one first.`);
  const snapshot = createEmptySnapshot(name);
  return prisma.blueprint.create({ data: { guildId, name, description, creatorId, data: JSON.stringify(snapshot) } });
}

async function loadMutable(guildId: string, name: string): Promise<{ id: string; snapshot: ServerSnapshot }> {
  const bp = await getBlueprint(guildId, name);
  if (!bp) throw new Error(`No blueprint named "${name}" was found. Create one first with /tun blueprint create-empty or /tun blueprint save.`);
  return { id: bp.id, snapshot: JSON.parse(bp.data) as ServerSnapshot };
}

async function persist(id: string, snapshot: ServerSnapshot) {
  await prisma.blueprint.update({ where: { id }, data: { data: JSON.stringify(snapshot) } });
}

export async function addCategoryToBlueprint(guildId: string, blueprintName: string, categoryName: string): Promise<CategorySnapshot> {
  const { id, snapshot } = await loadMutable(guildId, blueprintName);
  if (snapshot.categories.some((c) => c.name.toLowerCase() === categoryName.toLowerCase())) {
    throw new Error(`Blueprint "${blueprintName}" already has a category named "${categoryName}".`);
  }
  const created: CategorySnapshot = {
    id: `draft-${Date.now()}`,
    name: categoryName,
    position: snapshot.categories.length,
    overwrites: [],
  };
  snapshot.categories.push(created);
  await persist(id, snapshot);
  return created;
}

export async function addChannelToBlueprint(
  guildId: string,
  blueprintName: string,
  channelName: string,
  type: string,
  categoryName: string | null,
  topic: string | null
): Promise<ChannelSnapshot> {
  const { id, snapshot } = await loadMutable(guildId, blueprintName);
  if (categoryName && !snapshot.categories.some((c) => c.name.toLowerCase() === categoryName.toLowerCase())) {
    throw new Error(`Blueprint "${blueprintName}" has no category named "${categoryName}" - add it first with /tun blueprint add-category.`);
  }
  if (snapshot.channels.some((c) => c.name.toLowerCase() === channelName.toLowerCase())) {
    throw new Error(`Blueprint "${blueprintName}" already has a channel named "${channelName}".`);
  }
  const created: ChannelSnapshot = {
    id: `draft-${Date.now()}`,
    name: channelName,
    type,
    parentName: categoryName,
    position: snapshot.channels.filter((c) => c.parentName === categoryName).length,
    topic,
    nsfw: false,
    rateLimitPerUser: null,
    bitrate: null,
    userLimit: null,
    overwrites: [],
  };
  snapshot.channels.push(created);
  await persist(id, snapshot);
  return created;
}

export async function addRoleToBlueprint(
  guildId: string,
  blueprintName: string,
  roleName: string,
  colorHex: string | null,
  hoist: boolean,
  mentionable: boolean
): Promise<RoleSnapshot> {
  const { id, snapshot } = await loadMutable(guildId, blueprintName);
  if (snapshot.roles.some((r) => r.name.toLowerCase() === roleName.toLowerCase())) {
    throw new Error(`Blueprint "${blueprintName}" already has a role named "${roleName}".`);
  }
  let color = 0;
  if (colorHex) {
    const parsed = parseInt(colorHex.replace("#", ""), 16);
    if (!Number.isNaN(parsed)) color = parsed;
  }
  const created: RoleSnapshot = {
    id: `draft-${Date.now()}`,
    name: roleName,
    color,
    hoist,
    mentionable,
    permissions: "0",
    position: snapshot.roles.length,
    managed: false,
    icon: null,
  };
  snapshot.roles.push(created);
  await persist(id, snapshot);
  return created;
}

function applyState(currentBitfieldStr: string, permissionName: string, state: "allow" | "deny"): string {
  if (!isValidPermissionName(permissionName)) {
    throw new Error(`"${permissionName}" is not a recognized Discord permission. Use the autocomplete list.`);
  }
  const flag = PermissionFlagsBits[permissionName];
  let bits = new PermissionsBitField(BigInt(currentBitfieldStr || "0"));
  bits = state === "allow" ? bits.add(flag) : bits.remove(flag);
  return bits.bitfield.toString();
}

export async function setRolePermissionInBlueprint(
  guildId: string,
  blueprintName: string,
  roleName: string,
  permissionName: string,
  state: "allow" | "deny"
): Promise<RoleSnapshot> {
  const { id, snapshot } = await loadMutable(guildId, blueprintName);
  const role = snapshot.roles.find((r) => r.name.toLowerCase() === roleName.toLowerCase());
  if (!role) throw new Error(`Blueprint "${blueprintName}" has no role named "${roleName}" - add it first with /tun blueprint add-role.`);
  role.permissions = applyState(role.permissions, permissionName, state);
  await persist(id, snapshot);
  return role;
}

export async function setEveryonePermissionInBlueprint(
  guildId: string,
  blueprintName: string,
  permissionName: string,
  state: "allow" | "deny"
): Promise<string> {
  const { id, snapshot } = await loadMutable(guildId, blueprintName);
  snapshot.everyonePermissions = applyState(snapshot.everyonePermissions ?? "0", permissionName, state);
  await persist(id, snapshot);
  return snapshot.everyonePermissions;
}

export async function addOverwriteToBlueprint(
  guildId: string,
  blueprintName: string,
  targetKind: "category" | "channel",
  targetName: string,
  subjectType: "role" | "member",
  subjectName: string,
  permissionName: string,
  state: "allow" | "deny"
): Promise<PermissionOverwriteSnapshot> {
  const { id, snapshot } = await loadMutable(guildId, blueprintName);
  const list: (CategorySnapshot | ChannelSnapshot)[] = targetKind === "category" ? snapshot.categories : snapshot.channels;
  const target = list.find((t) => t.name.toLowerCase() === targetName.toLowerCase());
  if (!target) throw new Error(`Blueprint "${blueprintName}" has no ${targetKind} named "${targetName}". Add it first.`);

  let entry = target.overwrites.find((o) => o.targetType === subjectType && o.targetName.toLowerCase() === subjectName.toLowerCase());
  if (!entry) {
    entry = { targetType: subjectType, targetName: subjectName, targetId: "draft", allow: "0", deny: "0" };
    target.overwrites.push(entry);
  }

  if (!isValidPermissionName(permissionName)) {
    throw new Error(`"${permissionName}" is not a recognized Discord permission. Use the autocomplete list.`);
  }
  const flag = PermissionFlagsBits[permissionName];
  let allowBits = new PermissionsBitField(BigInt(entry.allow));
  let denyBits = new PermissionsBitField(BigInt(entry.deny));
  if (state === "allow") {
    allowBits = allowBits.add(flag);
    denyBits = denyBits.remove(flag);
  } else {
    denyBits = denyBits.add(flag);
    allowBits = allowBits.remove(flag);
  }
  entry.allow = allowBits.bitfield.toString();
  entry.deny = denyBits.bitfield.toString();

  await persist(id, snapshot);
  return entry;
}
