import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { successEmbed } from "../utils/embed";
import { confirmAction } from "../utils/confirm";
import { createSafetyBackup } from "../services/backupService";

export const commandName = "tun-server";

const PROTECT_SLOTS = 5;

export function register(): SlashCommandBuilder {
  const cmd = new SlashCommandBuilder().setName("tun-server").setDescription("Whole-server structural operations - use with extreme care");
  cmd.addSubcommand((sub) => {
    sub.setName("wipe").setDescription("Delete every category and channel on the server (protected items excluded)");
    for (let i = 1; i <= PROTECT_SLOTS; i++) {
      sub.addChannelOption((opt) =>
        opt
          .setName(`protect_${i}`)
          .setDescription("A category or channel to keep - protecting a category also protects everything inside it")
          .setRequired(false)
      );
    }
    return sub;
  });
  return cmd;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild!;

  await safeExecute(interaction, `server ${sub}`, async () => {
    if (sub !== "wipe") return;

    await interaction.deferReply();

    const protectedIds = new Set<string>();
    for (let i = 1; i <= PROTECT_SLOTS; i++) {
      const protectedChannel = interaction.options.getChannel(`protect_${i}`);
      if (protectedChannel) protectedIds.add(protectedChannel.id);
    }

    for (const ch of guild.channels.cache.values()) {
      const anyCh = ch as any;
      if (anyCh.parentId && protectedIds.has(anyCh.parentId)) {
        protectedIds.add(ch.id);
      }
    }

    const allChannels = guild.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory && !protectedIds.has(c.id));
    const allCategories = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory && !protectedIds.has(c.id));
    const protectedList = guild.channels.cache.filter((c) => protectedIds.has(c.id));

    if (!allChannels.size && !allCategories.size) {
      await interaction.editReply({ embeds: [successEmbed("Nothing to wipe", "Every category and channel on this server is protected.")] });
      return;
    }

    const proceed = await confirmAction({
      interaction,
      title: "⚠️ WIPE ENTIRE SERVER STRUCTURE?",
      description:
        `This will permanently delete **${allCategories.size} categor${allCategories.size === 1 ? "y" : "ies"}** and ` +
        `**${allChannels.size} channel(s)**, including their message history. This CANNOT be undone except by restoring a backup.\n\n` +
        (protectedList.size
          ? `**Protected (will be kept):**\n${protectedList.map((c) => `• ${c.name}`).join("\n").slice(0, 900)}`
          : "⚠️ No items are protected - this deletes absolutely everything.") +
        `\n\nA safety backup will be created automatically before anything is deleted.`,
      strong: true,
      confirmLabel: "Yes, wipe the server",
    });
    if (!proceed) return;

    await createSafetyBackup(guild, interaction.user.id, "before full server wipe");

    let deletedChannels = 0;
    let deletedCategories = 0;
    const errors: string[] = [];

    for (const ch of allChannels.values()) {
      try {
        await ch.delete(`Server wipe by ${interaction.user.tag} via /tun-server wipe`);
        deletedChannels++;
      } catch (err: any) {
        errors.push(`${ch.name}: ${err?.message ?? "unknown error"}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    for (const ch of allCategories.values()) {
      try {
        await ch.delete(`Server wipe by ${interaction.user.tag} via /tun-server wipe`);
        deletedCategories++;
      } catch (err: any) {
        errors.push(`${ch.name}: ${err?.message ?? "unknown error"}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    const summary =
      `Deleted ${deletedCategories} categor${deletedCategories === 1 ? "y" : "ies"} and ${deletedChannels} channel(s).\n` +
      `Kept ${protectedList.size} protected item(s).` +
      (errors.length ? `\n⚠️ ${errors.length} item(s) failed to delete:\n${errors.slice(0, 5).join("\n")}` : "");

    await interaction.editReply({ embeds: [successEmbed("Server wiped", summary)] });
    return {
      target: guild.name,
      details: { deletedChannels, deletedCategories, protectedCount: protectedList.size, errors },
    };
  });
}
