import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { baseEmbed, successEmbed } from "../utils/embed";
import { addEmbassy, listEmbassies, removeEmbassy } from "../services/embassyService";

export const commandName = "tun-embassy";

export function register(): SlashCommandBuilder {
  const cmd = new SlashCommandBuilder().setName("tun-embassy").setDescription("Configure embassy channels and their external-alliance roles");
  cmd
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Register a channel as an embassy for an external alliance role")
        .addChannelOption((opt) => opt.setName("channel").setDescription("Embassy channel").setRequired(true))
        .addRoleOption((opt) => opt.setName("alliance_role").setDescription("Role for the external alliance's members").setRequired(true))
        .addStringOption((opt) => opt.setName("label").setDescription("Friendly label, e.g. alliance name").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Unregister an embassy channel")
        .addChannelOption((opt) => opt.setName("channel").setDescription("Embassy channel").setRequired(true))
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("List configured embassy channels"));
  return cmd;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild!;

  await safeExecute(interaction, `embassy ${sub}`, async () => {
    if (sub === "list") {
      const embassies = await listEmbassies(guild.id);
      const embed = baseEmbed(`🌐 Embassy Channels (${embassies.length})`).setDescription(
        embassies.length
          ? embassies.map((e) => `• <#${e.channelId}> ↔ <@&${e.allianceRoleId}>${e.label ? ` (${e.label})` : ""}`).join("\n")
          : "No embassy channels configured yet."
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === "add") {
      const channel = interaction.options.getChannel("channel", true);
      const role = interaction.options.getRole("alliance_role", true);
      const label = interaction.options.getString("label") ?? undefined;

      const ch: any = await guild.channels.fetch(channel.id);
      if (ch && "permissionOverwrites" in ch) {
        await ch.permissionOverwrites.edit(role.id, { ViewChannel: true, SendMessages: true }, { reason: `Embassy configured by ${interaction.user.tag}` });
      }

      await addEmbassy(guild.id, channel.id, role.id, label);
      await interaction.reply({ embeds: [successEmbed("Embassy configured", `${channel} ↔ ${role}`)] });
      return { target: channel.name };
    }

    if (sub === "remove") {
      const channel = interaction.options.getChannel("channel", true);
      const removed = await removeEmbassy(guild.id, channel.id);
      if (!removed) throw new Error("That channel is not registered as an embassy.");
      await interaction.reply({ embeds: [successEmbed("Embassy removed", channel.name)] });
      return { target: channel.name };
    }
  });
}
