import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { baseEmbed, successEmbed } from "../utils/embed";
import { confirmAction } from "../utils/confirm";
import { createSafetyBackup } from "../services/backupService";

export const key = "role";

const PROTECT_SLOTS = 5;
const SELECT_SLOTS = 5;

export function register(tun: SlashCommandBuilder) {
  tun.addSubcommandGroup((group) => {
    group
      .setName("role")
      .setDescription("Create, delete, edit, position, list and bulk-clear roles")
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
      .addSubcommand((sub) => {
        sub.setName("wipe-all").setDescription("Delete every deletable role, with optional protect slots to keep some");
        for (let i = 1; i <= PROTECT_SLOTS; i++) {
          sub.addRoleOption((opt) => opt.setName(`protect_${i}`).setDescription("A role to keep").setRequired(false));
        }
        return sub;
      })
      .addSubcommand((sub) => {
        sub.setName("wipe-selected").setDescription("Delete a specific set of roles (up to 5) in one go");
        for (let i = 1; i <= SELECT_SLOTS; i++) {
          sub.addRoleOption((opt) => opt.setName(`role_${i}`).setDescription("A role to delete").setRequired(i === 1));
        }
        return sub;
      });
    return group;
  });
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

    // Hierarchy check up front for anything targeting a single existing role.
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

    if (sub === "wipe-all") {
      const protectedIds = new Set<string>();
      for (let i = 1; i <= PROTECT_SLOTS; i++) {
        const r = interaction.options.getRole(`protect_${i}`);
        if (r) protectedIds.add(r.id);
      }

      // @everyone and managed roles (bot roles, Booster role, etc.) can
      // never be deleted by any bot - this is a hard Discord API limit,
      // not a choice this bot is making, so they're excluded up front
      // rather than surfacing as per-role errors.
      const candidates = guild.roles.cache.filter(
        (r) => r.id !== guild.id && !r.managed && !protectedIds.has(r.id)
      );

      const deletable = candidates.filter((r) => r.editable);
      const skippedHierarchy = candidates.filter((r) => !r.editable);

      if (!deletable.size) {
        await interaction.editReply({
          embeds: [successEmbed("Nothing to wipe", "No deletable roles remain after protections and hierarchy limits are applied.")],
        });
        return;
      }

      const protectedRoles = guild.roles.cache.filter((r) => protectedIds.has(r.id));
      const proceed = await confirmAction({
        interaction,
        title: "⚠️ DELETE ALL ROLES?",
        description:
          `This will permanently delete **${deletable.size} role(s)**, removing them from every member who has them. This CANNOT be undone except by restoring a backup.\n\n` +
          (protectedRoles.size ? `**Protected (will be kept):**\n${protectedRoles.map((r) => `• ${r.name}`).join("\n").slice(0, 800)}\n\n` : "") +
          (skippedHierarchy.size
            ? `**Cannot be touched (above the bot's own role):**\n${skippedHierarchy.map((r) => `• ${r.name}`).join("\n").slice(0, 500)}\n\n`
            : "") +
          `A safety backup will be created automatically before anything is deleted.`,
        strong: true,
        confirmLabel: "Yes, delete all these roles",
      });
      if (!proceed) return;

      await createSafetyBackup(guild, interaction.user.id, "before wiping all roles");

      let deleted = 0;
      const errors: string[] = [];
      for (const role of deletable.values()) {
        try {
          await role.delete(`Role wipe-all by ${interaction.user.tag}`);
          deleted++;
        } catch (err: any) {
          errors.push(`${role.name}: ${err?.message ?? "unknown error"}`);
        }
        await new Promise((r) => setTimeout(r, 600));
      }

      const summary =
        `Deleted ${deleted} role(s). Kept ${protectedRoles.size} protected, skipped ${skippedHierarchy.size} above the bot's hierarchy.` +
        (errors.length ? `\n⚠️ ${errors.length} error(s):\n${errors.slice(0, 5).join("\n")}` : "");
      await interaction.editReply({ embeds: [successEmbed("Roles wiped", summary)] });
      return { target: guild.name, details: { deleted, protectedCount: protectedRoles.size, skippedHierarchy: skippedHierarchy.size, errors } };
    }

    if (sub === "wipe-selected") {
      const roles: { id: string; name: string; editable: boolean; managed: boolean }[] = [];
      for (let i = 1; i <= SELECT_SLOTS; i++) {
        const r = interaction.options.getRole(`role_${i}`);
        if (!r) continue;
        const fullRole = guild.roles.cache.get(r.id);
        roles.push({ id: r.id, name: r.name, editable: fullRole?.editable ?? false, managed: fullRole?.managed ?? false });
      }

      const deletableList = roles.filter((r) => r.editable && !r.managed);
      const blockedList = roles.filter((r) => !r.editable || r.managed);

      if (!deletableList.length) {
        throw new Error("None of the selected roles can be deleted (managed roles and roles above the bot's own role can never be deleted).");
      }

      const proceed = await confirmAction({
        interaction,
        title: `Delete ${deletableList.length} selected role(s)?`,
        description:
          `Will delete:\n${deletableList.map((r) => `• ${r.name}`).join("\n")}` +
          (blockedList.length
            ? `\n\n⚠️ Cannot delete (managed or above the bot's role, skipped automatically):\n${blockedList.map((r) => `• ${r.name}`).join("\n")}`
            : "") +
          `\n\nA safety backup will be created automatically first.`,
        strong: true,
        confirmLabel: "Yes, delete these roles",
      });
      if (!proceed) return;

      await createSafetyBackup(guild, interaction.user.id, "before wiping selected roles");

      let deleted = 0;
      const errors: string[] = [];
      for (const r of deletableList) {
        try {
          const fullRole = guild.roles.cache.get(r.id);
          await fullRole?.delete(`Role wipe-selected by ${interaction.user.tag}`);
          deleted++;
        } catch (err: any) {
          errors.push(`${r.name}: ${err?.message ?? "unknown error"}`);
        }
        await new Promise((res) => setTimeout(res, 600));
      }

      const summary =
        `Deleted ${deleted} role(s).` +
        (blockedList.length ? ` Skipped ${blockedList.length} that couldn't be touched.` : "") +
        (errors.length ? `\n⚠️ ${errors.length} error(s):\n${errors.join("\n")}` : "");
      await interaction.editReply({ embeds: [successEmbed("Selected roles deleted", summary)] });
      return { target: guild.name, details: { deleted, blocked: blockedList.length, errors } };
    }
  });
}