import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { baseEmbed, successEmbed } from "../utils/embed";
import { confirmAction } from "../utils/confirm";
import { createSafetyBackup } from "../services/backupService";

export const key = "channel";

const CHANNEL_TYPE_CHOICES = [
  { name: "Text", value: "text" },
  { name: "Voice", value: "voice" },
  { name: "Announcement", value: "announcement" },
  { name: "Forum", value: "forum" },
  { name: "Stage", value: "stage" },
];

function resolveChannelType(value: string): ChannelType {
  switch (value) {
    case "voice":
      return ChannelType.GuildVoice;
    case "announcement":
      return ChannelType.GuildAnnouncement;
    case "forum":
      return ChannelType.GuildForum;
    case "stage":
      return ChannelType.GuildStageVoice;
    default:
      return ChannelType.GuildText;
  }
}

export function register(tun: SlashCommandBuilder) {
  tun.addSubcommandGroup((group) =>
    group
      .setName("channel")
      .setDescription("Create, delete, rename, move, edit and list channels")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Create a new channel")
          .addStringOption((opt) => opt.setName("name").setDescription("Channel name").setRequired(true))
          .addStringOption((opt) => opt.setName("type").setDescription("Channel type").setRequired(false).addChoices(...CHANNEL_TYPE_CHOICES))
          .addChannelOption((opt) =>
            opt.setName("category").setDescription("Parent category").addChannelTypes(ChannelType.GuildCategory).setRequired(false)
          )
          .addStringOption((opt) => opt.setName("topic").setDescription("Channel topic").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("delete")
          .setDescription("Delete a channel")
          .addChannelOption((opt) => opt.setName("channel").setDescription("Channel to delete").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("rename")
          .setDescription("Rename a channel")
          .addChannelOption((opt) => opt.setName("channel").setDescription("Channel to rename").setRequired(true))
          .addStringOption((opt) => opt.setName("new_name").setDescription("New name").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("move")
          .setDescription("Move a channel to a different category and/or position")
          .addChannelOption((opt) => opt.setName("channel").setDescription("Channel to move").setRequired(true))
          .addChannelOption((opt) =>
            opt.setName("category").setDescription("New parent category").addChannelTypes(ChannelType.GuildCategory).setRequired(false)
          )
          .addIntegerOption((opt) => opt.setName("position").setDescription("New position within category").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("edit")
          .setDescription("Edit channel settings")
          .addChannelOption((opt) => opt.setName("channel").setDescription("Channel to edit").setRequired(true))
          .addStringOption((opt) => opt.setName("topic").setDescription("New topic").setRequired(false))
          .addBooleanOption((opt) => opt.setName("nsfw").setDescription("Mark as age-restricted").setRequired(false))
          .addIntegerOption((opt) => opt.setName("slowmode_seconds").setDescription("Slowmode in seconds (0 = off)").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("list")
          .setDescription("List channels")
          .addChannelOption((opt) =>
            opt.setName("category").setDescription("Only list channels in this category").addChannelTypes(ChannelType.GuildCategory).setRequired(false)
          )
      )
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild!;

  await safeExecute(interaction, `channel ${sub}`, async () => {
    if (sub === "list") {
      const category = interaction.options.getChannel("category");
      const channels = guild.channels.cache
        .filter((c) => c.type !== ChannelType.GuildCategory && (!category || (c as any).parentId === category.id))
        .sort((a: any, b: any) => a.rawPosition - b.rawPosition);
      const embed = baseEmbed(`📄 Channels (${channels.size})`).setDescription(
        channels.size
          ? channels.map((c: any) => `${c.type === ChannelType.GuildVoice ? "🔊" : "#"} ${c.name} \`${c.id}\``).join("\n").slice(0, 4000)
          : "No channels found."
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === "create") {
      const name = interaction.options.getString("name", true);
      const typeValue = interaction.options.getString("type") ?? "text";
      const category = interaction.options.getChannel("category");
      const topic = interaction.options.getString("topic") ?? undefined;

      const created = await guild.channels.create({
        name,
        type: resolveChannelType(typeValue) as any,
        parent: category?.id,
        topic,
        reason: `Created by ${interaction.user.tag} via /tun channel create`,
      });
      await interaction.reply({ embeds: [successEmbed("Channel created", `${created} (\`${created.id}\`)`)] });
      return { target: created.name };
    }

    await interaction.deferReply();

    if (sub === "delete") {
      const channel = interaction.options.getChannel("channel", true);
      const proceed = await confirmAction({
        interaction,
        title: `Delete channel "${channel.name}"?`,
        description: "This permanently deletes the channel and its message history. This cannot be undone by TUN Server Manager (message content is not backed up).",
      });
      if (!proceed) return;

      await createSafetyBackup(guild, interaction.user.id, `before deleting channel ${channel.name}`);
      const ch = await guild.channels.fetch(channel.id);
      await ch?.delete(`Deleted by ${interaction.user.tag} via /tun channel delete`);
      await interaction.editReply({ embeds: [successEmbed("Channel deleted", channel.name)] });
      return { target: channel.name };
    }

    if (sub === "rename") {
      const channel = interaction.options.getChannel("channel", true);
      const newName = interaction.options.getString("new_name", true);
      const ch: any = await guild.channels.fetch(channel.id);
      const oldName = ch.name;
      await ch.setName(newName, `Renamed by ${interaction.user.tag} via /tun channel rename`);
      await interaction.editReply({ embeds: [successEmbed("Channel renamed", `${oldName} → ${newName}`)] });
      return { target: newName, details: { oldName } };
    }

    if (sub === "move") {
      const channel = interaction.options.getChannel("channel", true);
      const category = interaction.options.getChannel("category");
      const position = interaction.options.getInteger("position");
      const ch: any = await guild.channels.fetch(channel.id);
      if (category) await ch.setParent(category.id, { lockPermissions: false });
      if (position !== null && position !== undefined) await ch.setPosition(position);
      await interaction.editReply({ embeds: [successEmbed("Channel moved", channel.name)] });
      return { target: channel.name };
    }

    if (sub === "edit") {
      const channel = interaction.options.getChannel("channel", true);
      const topic = interaction.options.getString("topic");
      const nsfw = interaction.options.getBoolean("nsfw");
      const slowmode = interaction.options.getInteger("slowmode_seconds");
      const ch: any = await guild.channels.fetch(channel.id);

      const changes: string[] = [];
      if (topic !== null && "setTopic" in ch) {
        await ch.setTopic(topic);
        changes.push("topic");
      }
      if (nsfw !== null && "setNSFW" in ch) {
        await ch.setNSFW(nsfw);
        changes.push("nsfw");
      }
      if (slowmode !== null && "setRateLimitPerUser" in ch) {
        await ch.setRateLimitPerUser(slowmode);
        changes.push("slowmode");
      }
      if (!changes.length) throw new Error("No editable fields were provided.");

      await interaction.editReply({ embeds: [successEmbed("Channel updated", `${channel.name}: ${changes.join(", ")}`)] });
      return { target: channel.name, details: { changes } };
    }
  });
}
