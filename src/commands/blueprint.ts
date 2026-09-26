import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
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
import { diffSnapshots, summarizeDiff } from "../services/diffService";
import { captureSnapshot } from "../services/snapshotService";
import { applyRestore, RestoreScope } from "../services/restoreService";
import { createSafetyBackup } from "../services/backupService";

export const key = "blueprint";

const SCOPE_CHOICES = [
  { name: "Everything", value: "full" },
  { name: "Categories only", value: "categories" },
  { name: "Channels only", value: "channels" },
  { name: "Roles only", value: "roles" },
];

export function register(tun: SlashCommandBuilder) {
  tun.addSubcommandGroup((group) =>
    group
      .setName("blueprint")
      .setDescription("Save, compare, restore, import and export server blueprints")
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
  );
}

export async function autocomplete(interaction: any) {
  const focused = interaction.options.getFocused();
  const blueprints = await listBlueprints(interaction.guildId);
  const choices = blueprints.filter((b) => b.name.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);
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
          : "No blueprints saved yet. Use `/tun blueprint save` to create one."
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
          { name: "Roles", value: String(snap.roles.length), inline: true }
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
        `\nCategories: +${result.categoriesCreated.length} created, ${result.categoriesUpdated.length} updated` +
        `\nChannels: +${result.channelsCreated.length} created, ${result.channelsUpdated.length} updated` +
        deletedSummary +
        (result.errors.length ? `\n⚠️ ${result.errors.length} error(s) occurred - see logs.` : "");

      await interaction.followUp({ embeds: [successEmbed(`Blueprint "${name}" restored`, summary)] });
      return { target: name, details: { scope, deleteExtras, result } };
    }
  });
}
