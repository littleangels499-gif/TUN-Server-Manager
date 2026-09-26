import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { baseEmbed, successEmbed } from "../utils/embed";
import { confirmAction } from "../utils/confirm";
import { createSafetyBackup } from "../services/backupService";

export const key = "role";

export function register(tun: SlashCommandBuilder) {
  tun.addSubcommandGroup((group) =>
    group
      .setName("role")
      .setDescription("Create, delete, edit, position and list roles")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Create a new role")
          .addStringOption((opt) => opt.setName("name").setDescription("Role name").setRequired(true))
          .addStringOption((opt) => opt.setName("color").setDescription("Hex color, e.g. #5865F2").setRequired(false))
          .addBooleanOption((opt) => opt.setName("hoist").setDescription("Display separately in the member list").setRequired(false))
          .addBooleanOption((opt) => opt.setName("mentionable").setDescription("Allow anyone to @mention this role").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("delete")
          .setDescription("Delete a role")
          .addRoleOption((opt) => opt.setName("role").setDescription("Role to delete").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("edit")
          .setDescription("Edit a role's properties")
          .addRoleOption((opt) => opt.setName("role").setDescription("Role to edit").setRequired(true))
          .addStringOption((opt) => opt.setName("name").setDescription("New name").setRequired(false))
          .addStringOption((opt) => opt.setName("color").setDescription("New hex color, e.g. #5865F2").setRequired(false))
          .addBooleanOption((opt) => opt.setName("hoist").setDescription("Display separately in the member list").setRequired(false))
          .addBooleanOption((opt) => opt.setName("mentionable").setDescription("Allow anyone to @mention this role").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("position")
          .setDescription("Reposition a role in the hierarchy")
          .addRoleOption((opt) => opt.setName("role").setDescription("Role to reposition").setRequired(true))
          .addIntegerOption((opt) => opt.setName("position").setDescription("New position (higher = higher in hierarchy)").setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("List all roles"))
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild!;
  const botMember = await guild.members.fetchMe();

  await safeExecute(interaction, `role ${sub}`, async () => {
    if (sub === "list") {
      const roles = guild.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position);
      const embed = baseEmbed(`🎭 Roles (${roles.size})`).setDescription(
        roles.size
          ? roles.map((r) => `**${r.position}.** ${r} ${r.managed ? "_(managed)_" : ""}`).join("\n").slice(0, 4000)
          : "No roles found."
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === "create") {
      const name = interaction.options.getString("name", true);
      const colorHex = interaction.options.getString("color");
      const hoist = interaction.options.getBoolean("hoist") ?? false;
      const mentionable = interaction.options.getBoolean("mentionable") ?? false;

      const created = await guild.roles.create({
        name,
        color: (colorHex as any) ?? undefined,
        hoist,
        mentionable,
        reason: `Created by ${interaction.user.tag} via /tun role create`,
      });
      await interaction.reply({ embeds: [successEmbed("Role created", `${created}`)] });
      return { target: created.name };
    }

    // Hierarchy check up front for anything targeting an existing role.
    if (["delete", "edit", "position"].includes(sub)) {
      const role = interaction.options.getRole("role", true);
      const fullRole = guild.roles.cache.get(role.id);
      if (fullRole?.managed) {
        throw new Error(
          `**${role.name}** is a Discord-managed role (e.g. a bot's own role or the Booster role) and cannot be modified by TUN Server Manager. This is a Discord API restriction, not a bug.`
        );
      }
      if (fullRole && fullRole.position >= botMember.roles.highest.position) {
        throw new Error(
          `**${role.name}** is at or above TUN Server Manager's own highest role, so Discord will not let the bot modify it. Move the bot's role higher in Server Settings > Roles and try again.`
        );
      }
    }

    await interaction.deferReply();

    if (sub === "delete") {
      const role = interaction.options.getRole("role", true);
      const proceed = await confirmAction({
        interaction,
        title: `Delete role "${role.name}"?`,
        description: "This removes the role from every member who has it. This cannot be undone except by restoring a backup.",
      });
      if (!proceed) return;

      await createSafetyBackup(guild, interaction.user.id, `before deleting role ${role.name}`);
      const fullRole = guild.roles.cache.get(role.id);
      await fullRole?.delete(`Deleted by ${interaction.user.tag} via /tun role delete`);
      await interaction.editReply({ embeds: [successEmbed("Role deleted", role.name)] });
      return { target: role.name };
    }

    if (sub === "edit") {
      const role = interaction.options.getRole("role", true);
      const fullRole = guild.roles.cache.get(role.id)!;
      const name = interaction.options.getString("name");
      const colorHex = interaction.options.getString("color");
      const hoist = interaction.options.getBoolean("hoist");
      const mentionable = interaction.options.getBoolean("mentionable");

      await fullRole.edit({
        name: name ?? undefined,
        color: (colorHex as any) ?? undefined,
        hoist: hoist ?? undefined,
        mentionable: mentionable ?? undefined,
        reason: `Edited by ${interaction.user.tag} via /tun role edit`,
      });
      await interaction.editReply({ embeds: [successEmbed("Role updated", `${role}`)] });
      return { target: role.name };
    }

    if (sub === "position") {
      const role = interaction.options.getRole("role", true);
      const position = interaction.options.getInteger("position", true);
      const fullRole = guild.roles.cache.get(role.id)!;
      await fullRole.setPosition(position, { reason: `Repositioned by ${interaction.user.tag} via /tun role position` });
      await interaction.editReply({ embeds: [successEmbed("Role repositioned", `${role} → position ${position}`)] });
      return { target: role.name };
    }
  });
}
