import { AutocompleteInteraction, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { successEmbed } from "../utils/embed";
import { listBlueprints } from "../services/blueprintService";
import {
  addCategoryToBlueprint,
  addChannelToBlueprint,
  addOverwriteToBlueprint,
  addRoleToBlueprint,
  createEmptyBlueprint,
  setEveryonePermissionInBlueprint,
  setRolePermissionInBlueprint,
} from "../services/blueprintEditService";
import { filterPermissionNames } from "../utils/permissionsList";

// The from-scratch blueprint BUILDER, split out from tun-blueprint into its
// own command purely because of Discord's 8000-character-per-command size
// cap - see the comment at the top of blueprint.ts for why.
export const commandName = "tun-blueprint-build";

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

export function register(): SlashCommandBuilder {
  const cmd = new SlashCommandBuilder()
    .setName("tun-blueprint-build")
    .setDescription("Design a blueprint from scratch through commands alone - no live server needed");
  cmd
    .addSubcommand((sub) =>
      sub
        .setName("create-empty")
        .setDescription("Start a blank blueprint - build it with add-category/add-channel/add-role")
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
        .addStringOption((opt) => opt.setName("category_name").setDescription("Category name within this blueprint (must exist)").setRequired(false))
        .addStringOption((opt) => opt.setName("topic").setDescription("Channel topic").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("add-role")
        .setDescription("Add a role to a blueprint (no permissions yet - use set-role-permission)")
        .addStringOption((opt) => opt.setName("blueprint").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
        .addStringOption((opt) => opt.setName("role_name").setDescription("Role name").setRequired(true))
        .addStringOption((opt) => opt.setName("color").setDescription("Hex color, e.g. #5865F2").setRequired(false))
        .addBooleanOption((opt) => opt.setName("hoist").setDescription("Display separately in the member list").setRequired(false))
        .addBooleanOption((opt) => opt.setName("mentionable").setDescription("Allow anyone to @mention this role").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("set-role-permission")
        .setDescription("Grant or deny one permission for a role within a blueprint")
        .addStringOption((opt) => opt.setName("blueprint").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
        .addStringOption((opt) => opt.setName("role_name").setDescription("Role name (must already exist)").setRequired(true))
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
        .setDescription("Add a permission overwrite for a role/member within a blueprint")
        .addStringOption((opt) => opt.setName("blueprint").setDescription("Blueprint name").setRequired(true).setAutocomplete(true))
        .addStringOption((opt) =>
          opt.setName("target_kind").setDescription("Category or channel").setRequired(true).addChoices({ name: "Category", value: "category" }, { name: "Channel", value: "channel" })
        )
        .addStringOption((opt) => opt.setName("target_name").setDescription("Category/channel name (must already exist)").setRequired(true))
        .addStringOption((opt) =>
          opt.setName("subject_type").setDescription("Role or member").setRequired(true).addChoices({ name: "Role", value: "role" }, { name: "Member", value: "member" })
        )
        .addStringOption((opt) => opt.setName("subject_name").setDescription("Role name, or member's username tag").setRequired(true))
        .addStringOption((opt) => opt.setName("permission").setDescription("Permission name").setRequired(true).setAutocomplete(true))
        .addStringOption((opt) => opt.setName("state").setDescription("Allow or deny").setRequired(true).addChoices(...STATE_CHOICES))
    );
  return cmd;
}

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === "permission") {
    const choices = filterPermissionNames(String(focused.value));
    await interaction.respond(choices.map((c) => ({ name: c, value: c })));
    return;
  }

  const blueprints = await listBlueprints(interaction.guildId!);
  const query = String(focused.value).toLowerCase();
  const choices = blueprints.filter((b) => b.name.toLowerCase().includes(query)).slice(0, 25);
  await interaction.respond(choices.map((b) => ({ name: b.name, value: b.name })));
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild!;

  await safeExecute(interaction, `blueprint-build ${sub}`, async () => {
    if (sub === "create-empty") {
      const name = interaction.options.getString("name", true);
      const description = interaction.options.getString("description") ?? undefined;
      const bp = await createEmptyBlueprint(guild.id, name, description, interaction.user.id);
      await interaction.reply({
        embeds: [
          successEmbed(
            "Blank blueprint created",
            `"${bp.name}" has no categories, channels or roles yet.\nBuild it with the other /tun-blueprint-build subcommands - none of these touch any live server. When ready, use /tun-blueprint restore.`
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
  });
}
