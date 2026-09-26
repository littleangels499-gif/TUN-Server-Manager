import { PermissionFlagsBits } from "discord.js";

/** All known Discord permission flag names, e.g. "ManageChannels", "SendMessages". */
export const ALL_PERMISSION_NAMES: string[] = Object.keys(PermissionFlagsBits);

export function isValidPermissionName(name: string): name is keyof typeof PermissionFlagsBits {
  return name in PermissionFlagsBits;
}

export function filterPermissionNames(query: string, limit = 25): string[] {
  const q = query.toLowerCase();
  return ALL_PERMISSION_NAMES.filter((p) => p.toLowerCase().includes(q)).slice(0, limit);
}
