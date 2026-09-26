/**
 * A ServerSnapshot is the portable, JSON-serializable representation of a
 * Discord server's supported structure. It is the common payload used by
 * BOTH the Blueprint system (spec #6) and the Backup system (spec #8) -
 * a backup and a blueprint are the same shape of data, they just differ in
 * *when* and *why* they were taken.
 *
 * Design decision: roles/categories/channels are matched BY NAME, not by
 * Discord snowflake ID, when comparing or restoring. IDs are captured for
 * reference/audit purposes but restoring a blueprint onto a different
 * server (or a rebuilt channel with a new ID) only works if matching is
 * name-based. This is what makes blueprints portable/importable across
 * servers (spec #16). Document this clearly for admins: renaming something
 * and expecting a "restore" to treat it as the same object will NOT work -
 * a rename shows up as one delete + one create.
 */

export const SNAPSHOT_VERSION = 1 as const;

export interface PermissionOverwriteSnapshot {
  targetType: "role" | "member";
  /** Role name or member tag at capture time - used for name-based matching. */
  targetName: string;
  /** Original Discord ID, kept for audit/debug purposes only. */
  targetId: string;
  allow: string; // permission bitfield, serialized as string (BigInt-safe)
  deny: string;
}

export interface ChannelSnapshot {
  id: string;
  name: string;
  /** discord.js ChannelType name, e.g. "GuildText", "GuildVoice", "GuildForum" */
  type: string;
  /** Name of the parent category, or null if top-level. Matched by name. */
  parentName: string | null;
  position: number;
  topic: string | null;
  nsfw: boolean;
  rateLimitPerUser: number | null;
  bitrate: number | null;
  userLimit: number | null;
  overwrites: PermissionOverwriteSnapshot[];
}

export interface CategorySnapshot {
  id: string;
  name: string;
  position: number;
  overwrites: PermissionOverwriteSnapshot[];
}

export interface RoleSnapshot {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  /** Permission bitfield, serialized as string. */
  permissions: string;
  position: number;
  managed: boolean;
  icon: string | null;
}

export interface ServerSnapshot {
  snapshotVersion: typeof SNAPSHOT_VERSION;
  capturedAt: string; // ISO timestamp
  guildId: string;
  guildName: string;
  roles: RoleSnapshot[];
  /**
   * The @everyone role's BASE permissions (separate from `roles` because
   * @everyone can never be created/deleted/renamed/recolored - only its
   * permission bitfield can ever be changed). `null` means "this blueprint
   * doesn't define a base permission set" (e.g. a blueprint built from
   * scratch via /tun blueprint commands, before anyone decided what
   * @everyone should be able to do) - restore leaves it untouched in that
   * case rather than guessing.
   */
  everyonePermissions: string | null;
  categories: CategorySnapshot[];
  channels: ChannelSnapshot[];
  /** Properties Discord exposes but this bot deliberately does not capture. */
  unsupportedNote: string;
}

export const UNSUPPORTED_PROPERTIES_NOTE =
  "Not captured: message history, invites/vanity URL, webhooks, AutoMod rules, " +
  "welcome screen, server icon/banner/splash images, boost-perk state, " +
  "verification/2FA requirement level, integration-managed role properties, " +
  "and any Community-only settings. See docs/API_LIMITATIONS.md.";

/**
 * A brand-new, empty snapshot - the starting point for building a blueprint
 * entirely through bot commands (`/tun blueprint create-empty`, then
 * `add-category` / `add-channel` / `add-role` / `add-overwrite`), with no
 * live server involved at all.
 */
export function createEmptySnapshot(guildName: string): ServerSnapshot {
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    guildId: "unassigned",
    guildName,
    roles: [],
    everyonePermissions: null,
    categories: [],
    channels: [],
    unsupportedNote: UNSUPPORTED_PROPERTIES_NOTE,
  };
}