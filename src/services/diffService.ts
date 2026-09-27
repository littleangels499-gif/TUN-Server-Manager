import { CategorySnapshot, ChannelSnapshot, RoleSnapshot, ServerSnapshot } from "../types/snapshot";

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface DiffItem<T> {
  name: string;
  item: T;
  changes?: FieldChange[]; // only set for "changed"
}

export interface DiffResult {
  roles: { added: DiffItem<RoleSnapshot>[]; removed: DiffItem<RoleSnapshot>[]; changed: DiffItem<RoleSnapshot>[] };
  categories: {
    added: DiffItem<CategorySnapshot>[];
    removed: DiffItem<CategorySnapshot>[];
    changed: DiffItem<CategorySnapshot>[];
  };
  channels: {
    added: DiffItem<ChannelSnapshot>[];
    removed: DiffItem<ChannelSnapshot>[];
    changed: DiffItem<ChannelSnapshot>[];
  };
  /** true only when `from` defines a base permission set AND it differs from `to`'s. */
  everyoneChanged: boolean;
  isIdentical: boolean;
}

function byName<T extends { name: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.name.toLowerCase(), i]));
}

function diffRole(a: RoleSnapshot, b: RoleSnapshot): FieldChange[] {
  const changes: FieldChange[] = [];
  if (a.color !== b.color) changes.push({ field: "color", from: `#${a.color.toString(16)}`, to: `#${b.color.toString(16)}` });
  if (a.hoist !== b.hoist) changes.push({ field: "hoist", from: String(a.hoist), to: String(b.hoist) });
  if (a.mentionable !== b.mentionable) changes.push({ field: "mentionable", from: String(a.mentionable), to: String(b.mentionable) });
  if (a.permissions !== b.permissions) changes.push({ field: "permissions", from: a.permissions, to: b.permissions });
  return changes;
}

function diffChannel(a: ChannelSnapshot, b: ChannelSnapshot): FieldChange[] {
  const changes: FieldChange[] = [];
  if (a.type !== b.type) changes.push({ field: "type", from: a.type, to: b.type });
  if ((a.parentName ?? "") !== (b.parentName ?? "")) {
    changes.push({ field: "category", from: a.parentName ?? "(none)", to: b.parentName ?? "(none)" });
  }
  if ((a.topic ?? "") !== (b.topic ?? "")) changes.push({ field: "topic", from: a.topic ?? "(none)", to: b.topic ?? "(none)" });
  if (a.nsfw !== b.nsfw) changes.push({ field: "nsfw", from: String(a.nsfw), to: String(b.nsfw) });
  if (JSON.stringify(a.overwrites) !== JSON.stringify(b.overwrites)) {
    changes.push({ field: "permission overwrites", from: `${a.overwrites.length} entries`, to: `${b.overwrites.length} entries` });
  }
  return changes;
}

/**
 * Compares `from` (e.g. saved Blueprint/Backup) against `to` (e.g. live
 * server), matching roles/categories/channels BY NAME (see snapshot.ts).
 * Never mutates anything - pure comparison (spec #7: "must not modify the
 * server").
 */
export function diffSnapshots(from: ServerSnapshot, to: ServerSnapshot): DiffResult {
  const result: DiffResult = {
    roles: { added: [], removed: [], changed: [] },
    categories: { added: [], removed: [], changed: [] },
    channels: { added: [], removed: [], changed: [] },
    everyoneChanged: from.everyonePermissions !== null && from.everyonePermissions !== to.everyonePermissions,
    isIdentical: true,
  };

  // Roles: "added" = present in `to` but not `from` (i.e. new on live server
  // relative to the blueprint); "removed" = present in `from` but not `to`.
  const fromRoles = byName(from.roles);
  const toRoles = byName(to.roles);
  for (const [name, role] of toRoles) {
    if (!fromRoles.has(name)) result.roles.added.push({ name: role.name, item: role });
  }
  for (const [name, role] of fromRoles) {
    const match = toRoles.get(name);
    if (!match) {
      result.roles.removed.push({ name: role.name, item: role });
    } else {
      const changes = diffRole(role, match);
      if (changes.length) result.roles.changed.push({ name: role.name, item: match, changes });
    }
  }

  const fromCats = byName(from.categories);
  const toCats = byName(to.categories);
  for (const [name, cat] of toCats) {
    if (!fromCats.has(name)) result.categories.added.push({ name: cat.name, item: cat });
  }
  for (const [name, cat] of fromCats) {
    const match = toCats.get(name);
    if (!match) result.categories.removed.push({ name: cat.name, item: cat });
    else if (JSON.stringify(cat.overwrites) !== JSON.stringify(match.overwrites)) {
      result.categories.changed.push({
        name: cat.name,
        item: match,
        changes: [{ field: "permission overwrites", from: `${cat.overwrites.length} entries`, to: `${match.overwrites.length} entries` }],
      });
    }
  }

  const fromChans = byName(from.channels);
  const toChans = byName(to.channels);
  for (const [name, ch] of toChans) {
    if (!fromChans.has(name)) result.channels.added.push({ name: ch.name, item: ch });
  }
  for (const [name, ch] of fromChans) {
    const match = toChans.get(name);
    if (!match) {
      result.channels.removed.push({ name: ch.name, item: ch });
    } else {
      const changes = diffChannel(ch, match);
      if (changes.length) result.channels.changed.push({ name: ch.name, item: match, changes });
    }
  }

  result.isIdentical =
    !result.roles.added.length &&
    !result.roles.removed.length &&
    !result.roles.changed.length &&
    !result.categories.added.length &&
    !result.categories.removed.length &&
    !result.categories.changed.length &&
    !result.channels.added.length &&
    !result.channels.removed.length &&
    !result.channels.changed.length &&
    !result.everyoneChanged;

  return result;
}

export function summarizeDiff(diff: DiffResult): string {
  const lines: string[] = [];
  const section = (label: string, d: { added: DiffItem<any>[]; removed: DiffItem<any>[]; changed: DiffItem<any>[] }) => {
    if (!d.added.length && !d.removed.length && !d.changed.length) return;
    lines.push(`**${label}**`);
    for (const a of d.added) lines.push(`  🟢 + ${a.name}`);
    for (const r of d.removed) lines.push(`  🔴 - ${r.name}`);
    for (const c of d.changed) lines.push(`  🟡 ~ ${c.name} (${c.changes?.map((x) => x.field).join(", ")})`);
  };
  section("Categories", diff.categories);
  section("Channels", diff.channels);
  section("Roles", diff.roles);
  if (diff.everyoneChanged) lines.push("**@everyone base permissions**\n  🟡 ~ base permission set differs");
  return lines.length ? lines.join("\n") : "No differences found.";
}
