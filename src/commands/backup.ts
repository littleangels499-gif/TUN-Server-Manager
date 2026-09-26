import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { baseEmbed, successEmbed } from "../utils/embed";
import { confirmAction } from "../utils/confirm";
import {
  createBackup,
  deleteBackup,
  getBackup,
  getLatestSafetyBackup,
  listBackups,
  parseBackupSnapshot,
} from "../services/backupService";
import { diffSnapshots, summarizeDiff } from "../services/diffService";
import { captureSnapshot } from "../services/snapshotService";
import { applyRestore, RestoreScope } from "../services/restoreService";

export const key = "backup";

const SCOPE_CHOICES = [
  { name: "Everything", value: "full" },
  { name: "Categories only", value: "categories" },
  { name: "Channels only", value: "channels" },
  { name: "Roles only", value: "roles" },
];

export function register(tun: SlashCommandBuilder) {
  tun.addSubcommandGroup((group) =>
    group
      .setName("backup")
      .setDescription("Create, list, view, restore, delete and roll back backups (disaster recovery)")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Create a manual backup of the live server right now")
          .addStringOption((opt) => opt.setName("label").setDescription("Label for this backup").setRequired(false))
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("List available backups"))
      .addSubcommand((sub) =>
        sub
          .setName("view")
          .setDescription("View a backup's contents summary")
          .addStringOption((opt) => opt.setName("id").setDescription("Backup ID (from /tun backup list)").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("restore")
          .setDescription("Preview and (after confirmation) restore a backup onto the live server")
          .addStringOption((opt) => opt.setName("id").setDescription("Backup ID").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("scope").setDescription("What to restore").setRequired(false).addChoices(...SCOPE_CHOICES))
      )
      .addSubcommand((sub) =>
        sub
          .setName("delete")
          .setDescription("Delete a backup")
          .addStringOption((opt) => opt.setName("id").setDescription("Backup ID").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub.setName("rollback").setDescription("Undo the last operation by restoring the most recent automatic safety backup")
      )
  );
}

export async function autocomplete(interaction: any) {
  const focused = interaction.options.getFocused();
  const backups = await listBackups(interaction.guildId, 25);
  const choices = backups
    .filter((b) => b.label.toLowerCase().includes(focused.toLowerCase()) || b.id.includes(focused))
    .map((b) => ({ name: `${b.label} - ${b.createdAt.toISOString().slice(0, 16)} (${b.id.slice(0, 8)})`, value: b.id }));
  await interaction.respond(choices.slice(0, 25));
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild!;

  await safeExecute(interaction, `backup ${sub}`, async () => {
    if (sub === "list") {
      const backups = await listBackups(guild.id);
      const embed = baseEmbed(`🛟 Backups (${backups.length})`).setDescription(
        backups.length
          ? backups
              .map((b) => `• **${b.label}** _(${b.reason})_ - ${b.createdAt.toUTCString()} - \`${b.id.slice(0, 8)}\``)
              .join("\n")
          : "No backups yet. Use `/tun backup create` or let TUN Server Manager create one automatically before a destructive change."
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === "create") {
      const label = interaction.options.getString("label") ?? `manual backup`;
      await interaction.deferReply();
      const bk = await createBackup(guild, label, "manual", interaction.user.id);
      await interaction.editReply({ embeds: [successEmbed("Backup created", `"${bk.label}" (\`${bk.id.slice(0, 8)}\`)`)] });
      return { target: bk.id };
    }

    if (sub === "view") {
      const id = interaction.options.getString("id", true);
      const bk = await getBackup(guild.id, id);
      if (!bk) throw new Error("Backup not found. Use /tun backup list to see valid IDs.");
      const snap = parseBackupSnapshot(bk.data);
      const embed = baseEmbed(`🛟 Backup: ${bk.label}`).addFields(
        { name: "Reason", value: bk.reason, inline: true },
        { name: "Created by", value: `<@${bk.creatorId}>`, inline: true },
        { name: "Created", value: bk.createdAt.toUTCString(), inline: false },
        { name: "Categories", value: String(snap.categories.length), inline: true },
        { name: "Channels", value: String(snap.channels.length), inline: true },
        { name: "Roles", value: String(snap.roles.length), inline: true }
      );
      await interaction.reply({ embeds: [embed] });
      return { target: bk.id };
    }

    if (sub === "delete") {
      const id = interaction.options.getString("id", true);
      await interaction.deferReply();
      const proceed = await confirmAction({
        interaction,
        title: "Delete this backup?",
        description: "This only removes the stored backup record - it does not change your live server. This cannot be undone.",
      });
      if (!proceed) return;
      const deleted = await deleteBackup(guild.id, id);
      if (!deleted) throw new Error("Backup not found.");
      await interaction.followUp({ embeds: [successEmbed("Backup deleted", deleted.label)] });
      return { target: deleted.label };
    }

    if (sub === "restore" || sub === "rollback") {
      await interaction.deferReply();

      const bk = sub === "rollback" ? await getLatestSafetyBackup(guild.id) : await getBackup(guild.id, interaction.options.getString("id", true));
      if (!bk) {
        throw new Error(
          sub === "rollback"
            ? "No automatic safety backup was found to roll back to. Safety backups are created automatically before destructive operations."
            : "Backup not found. Use /tun backup list to see valid IDs."
        );
      }

      const scope = (interaction.options.getString("scope") ?? "full") as RestoreScope;
      const target = parseBackupSnapshot(bk.data);
      const live = await captureSnapshot(guild);
      const diff = diffSnapshots(live, target);

      if (diff.isIdentical) {
        await interaction.editReply({ embeds: [successEmbed("Nothing to restore", "The live server already matches this backup.")] });
        return { target: bk.id };
      }

      const proceed = await confirmAction({
        interaction,
        title: sub === "rollback" ? `Roll back to safety backup "${bk.label}"?` : `Restore backup "${bk.label}"?`,
        description: `The following changes will be made:\n${summarizeDiff(diff).slice(0, 3500)}`,
        strong: true,
      });
      if (!proceed) return;

      // A rollback/restore is itself a major operation - snapshot the
      // current (about-to-be-overwritten) state first so a bad rollback
      // can itself be rolled back (spec #10).
      await createBackup(guild, `rollback-point before restoring ${bk.label}`, "rollback-point", interaction.user.id);

      const result = await applyRestore({ guild, target, scope, apply: true });

      const summary =
        `Roles: +${result.rolesCreated.length} created, ${result.rolesUpdated.length} updated` +
        (result.rolesSkipped.length ? `, ${result.rolesSkipped.length} skipped (hierarchy)` : "") +
        (result.everyoneUpdated ? "\n@everyone base permissions updated" : "") +
        `\nCategories: +${result.categoriesCreated.length} created, ${result.categoriesUpdated.length} updated` +
        `\nChannels: +${result.channelsCreated.length} created, ${result.channelsUpdated.length} updated` +
        (result.overwritesSkipped.length
          ? `\n⚠️ Some permission overwrites referenced roles/members not found on this server, so were skipped: ${[...new Set(result.overwritesSkipped)].slice(0, 10).join(", ")}`
          : "") +
        (result.errors.length ? `\n⚠️ ${result.errors.length} error(s) occurred - see logs.` : "");

      await interaction.followUp({ embeds: [successEmbed(`Backup "${bk.label}" restored`, summary)] });
      return { target: bk.id, details: { scope, result } };
    }
  });
}