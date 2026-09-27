import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  OverwriteType,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { baseEmbed, successEmbed } from "../utils/embed";
import { filterPermissionNames, isValidPermissionName } from "../utils/permissionsList";
import { deleteTemplate, getTemplate, listTemplates, saveTemplate } from "../services/permissionTemplateService";

export const commandName = "tun-permission";

export function register(): SlashCommandBuilder {
  const cmd = new SlashCommandBuilder().setName("tun-permission").setDescription("Manage role/user permission overwrites on categories and channels");
  cmd
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set a permission overwrite to Allow, Deny or Inherit")
        .addChannelOption((opt) => opt.setName("target").setDescription("Category or channel").setRequired(true))
        .addStringOption((opt) => opt.setName("permission").setDescription("Permission name").setRequired(true).setAutocomplete(true))
        .addStringOption((opt) =>
          opt
            .setName("state")
            .setDescription("Allow, Deny or Inherit (clears the override)")
            .setRequired(true)
            .addChoices({ name: "Allow", value: "allow" }, { name: "Deny", value: "deny" }, { name: "Inherit", value: "inherit" })
        )
        .addRoleOption((opt) => opt.setName("role").setDescription("Role to apply this to").setRequired(false))
        .addUserOption((opt) => opt.setName("user").setDescription("User to apply this to (instead of a role)").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove ALL overwrites for a role or user on a target")
        .addChannelOption((opt) => opt.setName("target").setDescription("Category or channel").setRequired(true))
        .addRoleOption((opt) => opt.setName("role").setDescription("Role to clear").setRequired(false))
        .addUserOption((opt) => opt.setName("user").setDescription("User to clear (instead of a role)").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View permission overwrites on a category or channel")
        .addChannelOption((opt) => opt.setName("target").setDescription("Category or channel").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("template")
        .setDescription("Save, apply, list or delete a reusable permission template")
        .addStringOption((opt) =>
          opt
            .setName("action")
            .setDescription("What to do")
            .setRequired(true)
            .addChoices(
              { name: "Save (capture a channel's overwrites)", value: "save" },
              { name: "Apply (copy onto another channel)", value: "apply" },
              { name: "List", value: "list" },
              { name: "Delete", value: "delete" }
            )
        )
        .addStringOption((opt) => opt.setName("name").setDescription("Template name").setRequired(false))
        .addChannelOption((opt) => opt.setName("channel").setDescription("Source (save) or destination (apply) channel").setRequired(false))
    );
  return cmd;
}

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused();
  const choices = filterPermissionNames(focused);
  await interaction.respond(choices.map((c) => ({ name: c, value: c })));
}

function resolveSubject(interaction: ChatInputCommandInteraction) {
  const role = interaction.options.getRole("role");
  const user = interaction.options.getUser("user");
  if (role && user) throw new Error("Provide either a role or a user, not both.");
  if (!role && !user) throw new Error("Provide a role or a user to target.");
  return role ? { id: role.id, type: OverwriteType.Role as const, label: `role ${role.name}` } : { id: user!.id, type: OverwriteType.Member as const, label: `user ${user!.tag}` };
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild!;

  await safeExecute(interaction, `permission ${sub}`, async () => {
    if (sub === "view") {
      const target = interaction.options.getChannel("target", true);
      const ch: any = await guild.channels.fetch(target.id);
      const overwrites = ch.permissionOverwrites?.cache;
      if (!overwrites || !overwrites.size) {
        await interaction.reply({ embeds: [baseEmbed(`🔐 Overwrites: ${target.name}`).setDescription("No overwrites set - fully inherits from parent/@everyone.")] });
        return;
      }
      const lines: string[] = [];
      for (const ow of overwrites.values()) {
        const isRole = ow.type === OverwriteType.Role;
        const label = isRole ? `<@&${ow.id}>` : `<@${ow.id}>`;
        const allow = ow.allow.toArray();
        const deny = ow.deny.toArray();
        lines.push(`**${label}**\n✅ Allow: ${allow.length ? allow.join(", ") : "none"}\n⛔ Deny: ${deny.length ? deny.join(", ") : "none"}`);
      }
      await interaction.reply({ embeds: [baseEmbed(`🔐 Overwrites: ${target.name}`).setDescription(lines.join("\n\n").slice(0, 4000))] });
      return;
    }

    if (sub === "set") {
      const target = interaction.options.getChannel("target", true);
      const permName = interaction.options.getString("permission", true);
      const state = interaction.options.getString("state", true) as "allow" | "deny" | "inherit";
      if (!isValidPermissionName(permName)) throw new Error(`"${permName}" is not a recognized Discord permission. Use the autocomplete list.`);
      const subject = resolveSubject(interaction);

      const ch: any = await guild.channels.fetch(target.id);

      if (state === "allow") {
        await ch.permissionOverwrites.edit(subject.id, { [permName]: true }, { reason: `Set by ${interaction.user.tag} via /tun-permission set` });
      } else if (state === "deny") {
        await ch.permissionOverwrites.edit(subject.id, { [permName]: false }, { reason: `Set by ${interaction.user.tag} via /tun-permission set` });
      } else {
        await ch.permissionOverwrites.edit(subject.id, { [permName]: null }, { reason: `Cleared by ${interaction.user.tag} via /tun-permission set` });
      }

      await interaction.reply({ embeds: [successEmbed("Overwrite updated", `${target.name}: ${subject.label} → ${permName} = ${state}`)] });
      return { target: target.name, details: { subject: subject.label, permission: permName, state } };
    }

    if (sub === "remove") {
      const target = interaction.options.getChannel("target", true);
      const subject = resolveSubject(interaction);
      const ch: any = await guild.channels.fetch(target.id);
      await ch.permissionOverwrites.delete(subject.id, `Cleared by ${interaction.user.tag} via /tun-permission remove`);
      await interaction.reply({ embeds: [successEmbed("Overwrite removed", `${target.name}: ${subject.label} now fully inherits.`)] });
      return { target: target.name, details: { subject: subject.label } };
    }

    if (sub === "template") {
      const action = interaction.options.getString("action", true);
      const name = interaction.options.getString("name");
      const channelOpt = interaction.options.getChannel("channel");

      if (action === "list") {
        const templates = await listTemplates(guild.id);
        await interaction.reply({
          embeds: [baseEmbed("🔐 Permission Templates").setDescription(templates.length ? templates.map((t) => `• **${t.name}**`).join("\n") : "No templates saved yet.")],
        });
        return;
      }

      if (!name) throw new Error("A template `name` is required for this action.");

      if (action === "save") {
        if (!channelOpt) throw new Error("Specify `channel` - the channel/category to capture overwrites from.");
        const ch: any = await guild.channels.fetch(channelOpt.id);
        const entries = [...(ch.permissionOverwrites?.cache.values() ?? [])].map((ow: any) => ({
          targetType: ow.type === OverwriteType.Role ? ("role" as const) : ("member" as const),
          targetName:
            ow.type === OverwriteType.Role ? guild.roles.cache.get(ow.id)?.name ?? ow.id : guild.members.cache.get(ow.id)?.user.tag ?? ow.id,
          targetId: ow.id,
          allow: ow.allow.bitfield.toString(),
          deny: ow.deny.bitfield.toString(),
        }));
        await saveTemplate(guild.id, name, interaction.user.id, entries);
        await interaction.reply({ embeds: [successEmbed("Template saved", `"${name}" captured ${entries.length} overwrite(s) from ${channelOpt.name}.`)] });
        return { target: name };
      }

      if (action === "apply") {
        if (!channelOpt) throw new Error("Specify `channel` - the destination to apply the template to.");
        const template = await getTemplate(guild.id, name);
        if (!template) throw new Error(`No template named "${name}" was found.`);
        const ch: any = await guild.channels.fetch(channelOpt.id);

        let applied = 0;
        const skipped: string[] = [];
        for (const entry of template.entries) {
          const targetId =
            entry.targetType === "role"
              ? guild.roles.cache.find((r) => r.name.toLowerCase() === entry.targetName.toLowerCase())?.id
              : guild.members.cache.find((m) => m.user.tag.toLowerCase() === entry.targetName.toLowerCase())?.id;
          if (!targetId) {
            skipped.push(entry.targetName);
            continue;
          }

          const allowNames = new PermissionsBitField(BigInt(entry.allow)).toArray();
          const denyNames = new PermissionsBitField(BigInt(entry.deny)).toArray();
          const overwriteOptions: Record<string, boolean> = {};
          for (const p of allowNames) overwriteOptions[p] = true;
          for (const p of denyNames) overwriteOptions[p] = false;

          await ch.permissionOverwrites.create(targetId, overwriteOptions, {
            type: entry.targetType === "role" ? OverwriteType.Role : OverwriteType.Member,
            reason: `Template "${name}" applied by ${interaction.user.tag}`,
          });
          applied++;
        }
        await interaction.reply({
          embeds: [
            successEmbed(
              "Template applied",
              `Applied ${applied} overwrite(s) to ${channelOpt.name}.` + (skipped.length ? `\n⚠️ Skipped (not found in this server): ${skipped.join(", ")}` : "")
            ),
          ],
        });
        return { target: channelOpt.name, details: { template: name, applied, skipped } };
      }

      if (action === "delete") {
        await deleteTemplate(guild.id, name);
        await interaction.reply({ embeds: [successEmbed("Template deleted", name)] });
        return { target: name };
      }
    }
  });
}
