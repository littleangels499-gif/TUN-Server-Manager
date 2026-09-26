import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { baseEmbed, successEmbed } from "../utils/embed";
import { confirmAction } from "../utils/confirm";
import { createSafetyBackup } from "../services/backupService";

export const key = "category";

export function register(tun: SlashCommandBuilder) {
  tun.addSubcommandGroup((group) =>
    group
      .setName("category")
      .setDescription("Create, delete, rename, move and list categories")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Create a new category")
          .addStringOption((opt) => opt.setName("name").setDescription("Category name").setRequired(true))
          .addIntegerOption((opt) => opt.setName("position").setDescription("Position (0 = top)").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("delete")
          .setDescription("Delete a category (channels inside are NOT deleted, they become uncategorized)")
          .addChannelOption((opt) =>
            opt.setName("category").setDescription("Category to delete").addChannelTypes(ChannelType.GuildCategory).setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("rename")
          .setDescription("Rename a category")
          .addChannelOption((opt) =>
            opt.setName("category").setDescription("Category to rename").addChannelTypes(ChannelType.GuildCategory).setRequired(true)
          )
          .addStringOption((opt) => opt.setName("new_name").setDescription("New name").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("move")
          .setDescription("Reposition a category")
          .addChannelOption((opt) =>
            opt.setName("category").setDescription("Category to move").addChannelTypes(ChannelType.GuildCategory).setRequired(true)
          )
          .addIntegerOption((opt) => opt.setName("position").setDescription("New position (0 = top)").setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("List all categories"))
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild!;

  await safeExecute(interaction, `category ${sub}`, async () => {
    if (sub === "list") {
      const cats = guild.channels.cache
        .filter((c) => c.type === ChannelType.GuildCategory)
        .sort((a: any, b: any) => a.position - b.position);
      const embed = baseEmbed(`📐 Categories (${cats.size})`).setDescription(
        cats.size ? cats.map((c: any) => `**${c.position}.** ${c.name} \`${c.id}\``).join("\n") : "No categories found."
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === "create") {
      const name = interaction.options.getString("name", true);
      const position = interaction.options.getInteger("position") ?? undefined;
      const created = await guild.channels.create({ name, type: ChannelType.GuildCategory, position, reason: `Created by ${interaction.user.tag} via /tun category create` });
      await interaction.reply({ embeds: [successEmbed("Category created", `${created.name} (\`${created.id}\`)`)] });
      return { target: created.name };
    }

    // Everything below is destructive or structural enough to confirm first.
    await interaction.deferReply();

    if (sub === "delete") {
      const category = interaction.options.getChannel("category", true);
      const childCount = guild.channels.cache.filter((c: any) => c.parentId === category.id).size;
      const proceed = await confirmAction({
        interaction,
        title: `Delete category "${category.name}"?`,
        description: `This will delete the category itself. ${childCount} channel(s) inside will become uncategorized, not deleted.`,
      });
      if (!proceed) return;

      await createSafetyBackup(guild, interaction.user.id, `before deleting category ${category.name}`);
      const ch = await guild.channels.fetch(category.id);
      await ch?.delete(`Deleted by ${interaction.user.tag} via /tun category delete`);
      await interaction.editReply({ embeds: [successEmbed("Category deleted", category.name)] });
      return { target: category.name };
    }

    if (sub === "rename") {
      const category = interaction.options.getChannel("category", true);
      const newName = interaction.options.getString("new_name", true);
      const ch: any = await guild.channels.fetch(category.id);
      const oldName = ch.name;
      await ch.setName(newName, `Renamed by ${interaction.user.tag} via /tun category rename`);
      await interaction.editReply({ embeds: [successEmbed("Category renamed", `${oldName} → ${newName}`)] });
      return { target: newName, details: { oldName } };
    }

    if (sub === "move") {
      const category = interaction.options.getChannel("category", true);
      const position = interaction.options.getInteger("position", true);
      const ch: any = await guild.channels.fetch(category.id);
      await ch.setPosition(position, { reason: `Moved by ${interaction.user.tag} via /tun category move` });
      await interaction.editReply({ embeds: [successEmbed("Category moved", `${category.name} → position ${position}`)] });
      return { target: category.name };
    }
  });
}
