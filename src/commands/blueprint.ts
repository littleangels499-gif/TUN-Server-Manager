import { AttachmentBuilder, AutocompleteInteraction, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { baseEmbed, successEmbed } from "../utils/embed";
import { confirmAction } from "../utils/confirm";
import {
  deleteBlueprint,
  exportBlueprint,
  getBlueprint,
  listBlueprints,
  parseImportedBlueprint,
  parseSnapshot,
  renameBlueprint,
  saveBlueprint,
  saveImportedBlueprint,
} from "../services/blueprintService";
import {
  addCategoryToBlueprint,
  addChannelToBlueprint,
  addOverwriteToBlueprint,
  addRoleToBlueprint,
  createEmptyBlueprint,
  setEveryonePermissionInBlueprint,
  setRolePermissionInBlueprint,
} from "../services/blueprintEditService";
import { diffSnapshots, summarizeDiff } from "../services/diffService";
import { captureSnapshot } from "../services/snapshotService";
import { applyRestore, RestoreScope } from "../services/restoreService";
import { createSafetyBackup } from "../services/backupService";
import { filterPermissionNames } from "../utils/permissionsList";

export const key = "blueprint";

const SCOPE_CHOICES = [
  { name: "Everything", value: "full" },
  { name: "Categories only", value: "categories" },
  { name: "Channels only", value: "channels" },
  { name: "Roles only", value: "roles" },
];

const CHANNEL_TYPE_CHOICES = [
  { name: "Text", value: "GuildText" },
  { name: "Voice", value: "GuildVoice" },
  { name: "Announcement", value: "GuildAnnouncement" },
  { name: "Forum", value: "GuildForum" },
  { name: "Stage", value: "GuildStageVoice" },
];

const STATE_CHOICES = [
  { name: "Allow", value: "allow" },
  { name: "Deny", value: "deny" },
];

export function register(tun: SlashCommandBuilder) {
  tun.addSubcommandGroup((group) =>
    group
      .setName("blueprint")
      .setDescription("Save, build, compare, restore, import and export server blueprints")
      // ---- capture / manage ----
      .addSubcommand((sub) =>
        sub
          .setName("save")
          .setDescription("Save the current server structure as a named blueprint")
          .addStringOption((opt) => opt.setName("name").setDescription("Blueprint name").setRequired(true))
          .addStringOption((opt) => opt.setName("description").setDescription("Optional description").setRequired(false))
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("List saved blueprints"))
      .addSubcommand((sub) =>
        sub
          .setName("view")
          .setDescription("View a blueprint's contents summary")
          .addStringOption((opt) => opt.setName("name").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("compare")
          .setDescription("Compare a blueprint against the live server (read-only, no changes)")
          .addStringOption((opt) => opt.setName("name").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("restore")
          .setDescription("Preview and (after confirmation) restore a blueprint onto the live server")
          .addStringOption((opt) => opt.setName("name").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("scope").setDescription("What to restore").setRequired(false).addChoices(...SCOPE_CHOICES))
          .addBooleanOption((opt) => opt.setName("delete_extras").setDescription("Also delete live items not in the blueprint (dangerous)").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("export")
          .setDescription("Export a blueprint as a portable JSON file")
          .addStringOption((opt) => opt.setName("name").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("import")
          .setDescription("Import a blueprint JSON file (previewed before saving)")
          .addAttachmentOption((opt) => opt.setName("file").setDescription("Exported blueprint .json file").setRequired(true))
          .addStringOption((opt) => opt.setName("name").setDescription("Name to save it as").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("delete")
          .setDescription("Delete a saved blueprint")
          .addStringOption((opt) => opt.setName("name").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("rename")
          .setDescription("Rename a saved blueprint")
          .addStringOption((opt) => opt.setName("name").setDescription("Current name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("new_name").setDescription("New name").setRequired(true))
      )
      // ---- build from scratch, no live server needed ----
      .addSubcommand((sub) =>
        sub
          .setName("create-empty")
                    .setDescription("Start a blank blueprint - build it with add-category/add-channel/add-role, no server needed")
          .addStringOption((opt) => opt.setName("name").setDescription("Blueprint name").setRequired(true))
          .addStringOption((opt) => opt.setName("description").setDescription("Optional description").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("add-category")
          .setDescription("Add a category to a blueprint")
          .addStringOption((opt) => opt.setName("blueprint").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("category_name").setDescription("Category name").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("add-channel")
          .setDescription("Add a channel to a blueprint")
          .addStringOption((opt) => opt.setName("blueprint").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("channel_name").setDescription("Channel name").setRequired(true))
          .addStringOption((opt) => opt.setName("type").setDescription("Channel type").setRequired(false).addChoices(...CHANNEL_TYPE_CHOICES))
          .addStringOption((opt) => opt.setName("category_name").setDescription("Category name within this blueprint (must already exist)").setRequired(false))
          .addStringOption((opt) => opt.setName("topic").setDescription("Channel topic").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("add-role")
          .setDescription("Add a role to a blueprint (starts with no permissions - use set-role-permission to grant any)")
          .addStringOption((opt) => opt.setName("blueprint").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("role_name").setDescription("Role name").setRequired(true))
          .addStringOption((opt) => opt.setName("color").setDescription("Hex color, e.g. #5865F2").setRequired(false))
          .addBooleanOption((opt) => opt.setName("hoist").setDescription("Display separately in the member list").setRequired(false))
          .addBooleanOption((opt) => opt.setName("mentionable").setDescription("Allow anyone to @mention this role").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("set-role-permission")
          .setDescription("Grant or deny one server-wide permission for a role within a blueprint")
          .addStringOption((opt) => opt.setName("blueprint").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("role_name").setDescription("Role name (must already exist in the blueprint)").setRequired(true))
          .addStringOption((opt) => opt.setName("permission").setDescription("Permission name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("state").setDescription("Allow or deny").setRequired(true).addChoices(...STATE_CHOICES))
      )
      .addSubcommand((sub) =>
        sub
          .setName("set-everyone-permission")
          .setDescription("Grant or deny one base (@everyone) permission within a blueprint")
          .addStringOption((opt) => opt.setName("blueprint").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("permission").setDescription("Permission name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("state").setDescription("Allow or deny").setRequired(true).addChoices(...STATE_CHOICES))
      )
      .addSubcommand((sub) =>
        sub
          .setName("add-overwrite")
          .setDescription("Add a category/channel-level permission overwrite for a role or member within a blueprint")
          .addStringOption((opt) => opt.setName("blueprint").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) =>
            opt.setName("target_kind").setDescription("Category or channel").setRequired(true).addChoices({ name: "Category", value: "category" }, { name: "Channel", value: "channel" })
          )
          .addStringOption((opt) => opt.setName("target_name").setDescription("Category/channel name (must already exist in the blueprint)").setRequired(true))
          .addStringOption((opt) =>
            opt.setName("subject_type").setDescription("Role or member").setRequired(true).addChoices({ name: "Role", value: "role" }, { name: "Member", value: "member" })
          )
          .addStringOption((opt) => opt.setName("subject_name").setDescription("Role name, or member's username#0000 tag").setRequired(true))
          .addStringOption((opt) => opt.setName("permission").setDescription("Permission name").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("state").setDescription("Allow or deny").setRequired(true).addChoices(...STATE_CHOICES))
      )
  );
}

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === "permission") {
    const choices = filterPermissionNames(String(focused.value));
    await interaction.respond(choices.map((c) => ({ name: c, value: c })));
    return;
  }

  // "name" (existing blueprint) or "blueprint" (builder subcommands) both
  // autocomplete against the guild's saved blueprint names.
  const blueprints = await listBlueprints(interaction.guildId!);
  const query = String(focused.value).toLowerCase();
  const choices = blueprints.filter((b) => b.name.toLowerCase().includes(query)).slice(0, 25);
  await interaction.respond(choices.map((b) => ({ name: b.name, value: b.name })));
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild!;

  await safeExecute(interaction, `blueprint ${sub}`, async () => {
    if (sub === "list") {
      const blueprints = await listBlueprints(guild.id);
      const embed = baseEmbed(`🗺️ Blueprints (${blueprints.length})`).setDescription(
        blueprints.length
          ? blueprints.map((b) => `• **${b.name}** (v${b.version}) - ${b.description ?? "no description"}`).join("\n")
          : "No blueprints saved yet. Use `/tun blueprint save` (from a live server) or `/tun blueprint create-empty` (from scratch)."
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === "save") {
      const name = interaction.options.getString("name", true);
      const description = interaction.options.getString("description") ?? undefined;
      await interaction.deferReply();
      const bp = await saveBlueprint(guild, name, description, interaction.user.id);
      await interaction.editReply({ embeds: [successEmbed("Blueprint saved", `"${bp.name}" (v${bp.version})`)] });
      return { target: name };
    }

    if (sub === "create-empty") {
      const name = interaction.options.getString("name", true);
      const description = interaction.options.getString("description") ?? undefined;
      const bp = await createEmptyBlueprint(guild.id, name, description, interaction.user.id);
      await interaction.reply({
        embeds: [
          successEmbed(
            "Blank blueprint created",
            `"${bp.name}" has no categories, channels or roles yet.\nBuild it with \`/tun blueprint add-category\`, \`add-channel\`, \`add-role\`, \`set-role-permission\`, \`set-everyone-permission\` and \`add-overwrite\` - none of these touch any live server.`
          ),
        ],
      });
      return { target: name };
    }

    if (sub === "add-category") {
      const blueprint = interaction.options.getString("blueprint", true);
      const categoryName = interaction.options.getString("category_name", true);
      const created = await addCategoryToBlueprint(guild.id, blueprint, categoryName);
      await interaction.reply({ embeds: [successEmbed("Category added to blueprint", `"${blueprint}": + ${created.name}`)] });
      return { target: blueprint, details: { category: created.name } };
    }

    if (sub === "add-channel") {
      const blueprint = interaction.options.getString("blueprint", true);
      const channelName = interaction.options.getString("channel_name", true);
      const type = interaction.options.getString("type") ?? "GuildText";
      const categoryName = interaction.options.getString("category_name");
      const topic = interaction.options.getString("topic");
      const created = await addChannelToBlueprint(guild.id, blueprint, channelName, type, categoryName, topic);
      await interaction.reply({
        embeds: [successEmbed("Channel added to blueprint", `"${blueprint}": + ${created.name}${categoryName ? ` (in ${categoryName})` : ""}`)],
      });
      return { target: blueprint, details: { channel: created.name } };
    }

    if (sub === "add-role") {
      const blueprint = interaction.options.getString("blueprint", true);
      const roleName = interaction.options.getString("role_name", true);
      const color = interaction.options.getString("color");
      const hoist = interaction.options.getBoolean("hoist") ?? false;
      const mentionable = interaction.options.getBoolean("mentionable") ?? false;
      const created = await addRoleToBlueprint(guild.id, blueprint, roleName, color, hoist, mentionable);
      await interaction.reply({
        embeds: [successEmbed("Role added to blueprint", `"${blueprint}": + ${created.name} (no permissions yet - use set-role-permission to grant some)`)],
      });
      return { target: blueprint, details: { role: created.name } };
    }

    if (sub === "set-role-permission") {
      const blueprint = interaction.options.getString("blueprint", true);
      const roleName = interaction.options.getString("role_name", true);
      const permission = interaction.options.getString("permission", true);
      const state = interaction.options.getString("state", true) as "allow" | "deny";
      await setRolePermissionInBlueprint(guild.id, blueprint, roleName, permission, state);
      await interaction.reply({ embeds: [successEmbed("Role permission updated", `"${blueprint}": ${roleName} → ${permission} = ${state}`)] });
      return { target: blueprint, details: { role: roleName, permission, state } };
    }

    if (sub === "set-everyone-permission") {
      const blueprint = interaction.options.getString("blueprint", true);
      const permission = interaction.options.getString("permission", true);
      const state = interaction.options.getString("state", true) as "allow" | "deny";
      await setEveryonePermissionInBlueprint(guild.id, blueprint, permission, state);
      await interaction.reply({ embeds: [successEmbed("@everyone permission updated", `"${blueprint}": ${permission} = ${state}`)] });
      return { target: blueprint, details: { permission, state } };
    }

    if (sub === "add-overwrite") {
      const blueprint = interaction.options.getString("blueprint", true);
      const targetKind = interaction.options.getString("target_kind", true) as "category" | "channel";
      const targetName = interaction.options.getString("target_name", true);
      const subjectType = interaction.options.getString("subject_type", true) as "role" | "member";
      const subjectName = interaction.options.getString("subject_name", true);
      const permission = interaction.options.getString("permission", true);
      const state = interaction.options.getString("state", true) as "allow" | "deny";
      await addOverwriteToBlueprint(guild.id, blueprint, targetKind, targetName, subjectType, subjectName, permission, state);
      await interaction.reply({
        embeds: [successEmbed("Overwrite added to blueprint", `"${blueprint}": ${targetKind} "${targetName}" → ${subjectType} "${subjectName}" → ${permission} = ${state}`)],
      });
      return { target: blueprint, details: { targetKind, targetName, subjectType, subjectName, permission, state } };
    }

    if (sub === "view") {
      const name = interaction.options.getString("name", true);
      const bp = await getBlueprint(guild.id, name);
      if (!bp) throw new Error(`No blueprint named "${name}" was found.`);
      const snap = parseSnapshot(bp.data);
      const embed = baseEmbed(`🗺️ Blueprint: ${bp.name}`)
        .setDescription(bp.description ?? "_No description_")
        .addFields(
          { name: "Version", value: String(bp.version), inline: true },
          { name: "Created by", value: `<@${bp.creatorId}>`, inline: true },
          { name: "Captured", value: new Date(snap.capturedAt).toUTCString(), inline: false },
          { name: "Categories", value: String(snap.categories.length), inline: true },
          { name: "Channels", value: String(snap.channels.length), inline: true },
          { name: "Roles", value: String(snap.roles.length), inline: true },
          { name: "@everyone permissions defined?", value: snap.everyonePermissions !== null ? "Yes" : "No (won't be touched on restore)", inline: false }
        );
      await interaction.reply({ embeds: [embed] });
      return { target: name };
    }

    if (sub === "compare") {
      const name = interaction.options.getString("name", true);
      await interaction.deferReply();
      const bp = await getBlueprint(guild.id, name);
      if (!bp) throw new Error(`No blueprint named "${name}" was found.`);
      const saved = parseSnapshot(bp.data);
      const live = await captureSnapshot(guild);
      const diff = diffSnapshots(saved, live);
      const embed = baseEmbed(`🔍 Compare: "${name}" vs live server`)
        .setDescription(summarizeDiff(diff).slice(0, 4000))
        .setFooter({ text: diff.isIdentical ? "Server matches this blueprint exactly." : "Comparison only - no changes were made. Use /tun blueprint restore to apply." });
      await interaction.editReply({ embeds: [embed] });
      return { target: name, details: { isIdentical: diff.isIdentical } };
    }

    if (sub === "export") {
      const name = interaction.options.getString("name", true);
      const json = await exportBlueprint(guild.id, name);
      if (!json) throw new Error(`No blueprint named "${name}" was found.`);
      const file = new AttachmentBuilder(Buffer.from(json, "utf-8"), { name: `${name}.blueprint.json` });
      await interaction.reply({ embeds: [successEmbed("Blueprint exported", name)], files: [file] });
      return { target: name };
    }

    if (sub === "import") {
      const attachment = interaction.options.getAttachment("file", true);
      const name = interaction.options.getString("name", true);
      await interaction.deferReply();

      const res = await fetch(attachment.url);
      const text = await res.text();
      const imported = parseImportedBlueprint(text);
      const live = await captureSnapshot(guild);
      const diff = diffSnapshots(live, imported.snapshot);

      const proceed = await confirmAction({
        interaction,
        title: `Import blueprint as "${name}"?`,
        description:
          `This will SAVE the imported file as a new blueprint (it does NOT touch your live server yet).\n\n` +
          `Preview of what it contains relative to your current server:\n${summarizeDiff(diff).slice(0, 3500)}`,
      });
      if (!proceed) return;

      await saveImportedBlueprint(guild.id, imported, name, interaction.user.id);
      await interaction.followUp({ embeds: [successEmbed("Blueprint imported", `Saved as "${name}". Use /tun blueprint restore to apply it.`)] });
      return { target: name };
    }

    if (sub === "delete") {
      const name = interaction.options.getString("name", true);
      await interaction.deferReply();
      const proceed = await confirmAction({
        interaction,
        title: `Delete blueprint "${name}"?`,
        description: "This only deletes the saved blueprint record - it does not change your live server.",
      });
      if (!proceed) return;
      const deleted = await deleteBlueprint(guild.id, name);
      if (!deleted) throw new Error(`No blueprint named "${name}" was found.`);
      await interaction.followUp({ embeds: [successEmbed("Blueprint deleted", name)] });
      return { target: name };
    }

    if (sub === "rename") {
      const name = interaction.options.getString("name", true);
      const newName = interaction.options.getString("new_name", true);
      const renamed = await renameBlueprint(guild.id, name, newName);
      if (!renamed) throw new Error(`No blueprint named "${name}" was found.`);
      await interaction.reply({ embeds: [successEmbed("Blueprint renamed", `${name} → ${newName}`)] });
      return { target: newName };
    }

    if (sub === "restore") {
      const name = interaction.options.getString("name", true);
      const scope = (interaction.options.getString("scope") ?? "full") as RestoreScope;
      const deleteExtras = interaction.options.getBoolean("delete_extras") ?? false;

      await interaction.deferReply();
      const bp = await getBlueprint(guild.id, name);
      if (!bp) throw new Error(`No blueprint named "${name}" was found.`);
      const target = parseSnapshot(bp.data);
      const live = await captureSnapshot(guild);
      const diff = diffSnapshots(live, target);

      if (diff.isIdentical) {
        await interaction.editReply({ embeds: [successEmbed("Nothing to restore", "The live server already matches this blueprint.")] });
        return { target: name };
      }

      const proceed = await confirmAction({
        interaction,
        title: `Restore blueprint "${name}" (scope: ${scope})?`,
        description:
          `The following changes will be made:\n${summarizeDiff(diff).slice(0, 3200)}\n\n` +
          (deleteExtras
            ? "⚠️ **delete_extras is ON** - items on the live server not present in the blueprint will be DELETED."
            : "Live items not present in the blueprint will be left alone (additive/corrective restore)."),
        strong: deleteExtras,
      });
      if (!proceed) return;

      await createSafetyBackup(guild, interaction.user.id, `before restoring blueprint ${name}`);

      const progressMsgs: string[] = [];
      const result = await applyRestore({
        guild,
        target,
        scope,
        apply: true,
        onProgress: (m) => progressMsgs.push(m),
      });

      let deletedSummary = "";
      if (deleteExtras) {
        // Deletion is handled as an explicit, separate, throttled pass so
        // it's never bundled silently into a "restore" that only meant to
        // add/fix things.
        const toDeleteChannels = diff.channels.removed;
        const toDeleteCategories = diff.categories.removed;
        for (const c of toDeleteChannels) {
          const ch = guild.channels.cache.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
          if (ch) await ch.delete("delete_extras via /tun blueprint restore").catch(() => undefined);
        }
        for (const c of toDeleteCategories) {
          const ch = guild.channels.cache.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
          if (ch) await ch.delete("delete_extras via /tun blueprint restore").catch(() => undefined);
        }
        deletedSummary = `\nDeleted ${toDeleteChannels.length} channel(s), ${toDeleteCategories.length} categor${toDeleteCategories.length === 1 ? "y" : "ies"}.`;
      }

      const summary =
        `Roles: +${result.rolesCreated.length} created, ${result.rolesUpdated.length} updated` +
        (result.rolesSkipped.length ? `, ${result.rolesSkipped.length} skipped (hierarchy)` : "") +
        (result.everyoneUpdated ? "\n@everyone base permissions updated" : "") +
        `\nCategories: +${result.categoriesCreated.length} created, ${result.categoriesUpdated.length} updated` +
        `\nChannels: +${result.channelsCreated.length} created, ${result.channelsUpdated.length} updated` +
        deletedSummary +
        (result.overwritesSkipped.length
          ? `\n⚠️ Some permission overwrites referenced roles/members not found on this server, so were skipped: ${[...new Set(result.overwritesSkipped)].slice(0, 10).join(", ")}`
          : "") +
        (result.errors.length ? `\n⚠️ ${result.errors.length} error(s) occurred - see logs.` : "");

      await interaction.followUp({ embeds: [successEmbed(`Blueprint "${name}" restored`, summary)] });
      return { target: name, details: { scope, deleteExtras, result } };
    }
  });
}