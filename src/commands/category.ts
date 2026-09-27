import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { baseEmbed, successEmbed } from "../utils/embed";
import { confirmAction } from "../utils/confirm";
import { createSafetyBackup } from "../services/backupService";

export const commandName = "tun-category";

export function register(): SlashCommandBuilder {
  const cmd = new SlashCommandBuilder().setName("tun-category").setDescription("Create, delete, rename, move and list categories");
  cmd
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a new category")
        .addStringOption((opt) => opt.setName("name").setDescription("Category name").setRequired(true))
        .addIntegerOption((opt) => opt.setName("position").setDescription("Position (0 = top)").setRequired(false))
    )
    .addSubcommand((sub) => {
      sub
        .setName("delete")
        .setDescription("Delete a category, optionally bulk-deleting its channels (some can be protected)")
        .addChannelOption((opt) =>
          opt.setName("category").setDescription("Category to delete").addChannelTypes(ChannelType.GuildCategory).setRequired(true)
        )
        .addBooleanOption((opt) =>
          opt.setName("delete_channels").setDescription("Also delete channels inside (default: leave them, uncategorized)").setRequired(false)
        );
      for (let i = 1; i <= 5; i++) {
        sub.addChannelOption((opt) =>
          opt.setName(`protect_${i}`).setDescription("A channel inside this category to keep (requires delete_channels:true)").setRequired(false)
        );
      }
      return sub;
    })
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
    .addSubcommand((sub) => sub.setName("list").setDescription("List all categories"));
  return cmd;
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
      const created = await guild.channels.create({ name, type: ChannelType.GuildCategory, position, reason: `Created by ${interaction.user.tag} via /tun-category create` });
      await interaction.reply({ embeds: [successEmbed("Category created", `${created.name} (\`${created.id}\`)`)] });
      return { target: created.name };
    }

    // Everything below is destructive or structural enough to confirm first.
    await interaction.deferReply();

    if (sub === "delete") {
      const category = interaction.options.getChannel("category", true);
      const deleteChannels = interaction.options.getBoolean("delete_channels") ?? false;
      const children = guild.channels.cache.filter((c: any) => c.parentId === category.id);

      const protectedIds = new Set<string>();
      for (let i = 1; i <= 5; i++) {
        const p = interaction.options.getChannel(`protect_${i}`);
        if (p) protectedIds.add(p.id);
      }

      if (protectedIds.size && !deleteChannels) {
        throw new Error("protect_ options only apply when delete_channels is true - without it, all channels are already left untouched.");
      }

      const toKeep = children.filter((c) => protectedIds.has(c.id));
      const toDelete = children.filter((c) => !protectedIds.has(c.id));
      const keepsCategory = deleteChannels && toKeep.size > 0;

      const proceed = await confirmAction({
        interaction,
        title: `Delete category "${category.name}"?`,
        description: !deleteChannels
          ? `This will delete the category itself. ${children.size} channel(s) inside will become uncategorized, not deleted.`
          : toKeep.size
          ? `⚠️ This will delete ${toDelete.size} channel(s) inside "${category.name}", KEEPING ${toKeep.size} protected channel(s):\n${toKeep
              .map((c: any) => `• ${c.name}`)
              .join("\n")}\n\nBecause protected channels remain, the category itself will NOT be deleted.`
          : `⚠️ This will delete the category AND all ${children.size} channel(s) inside it. This cannot be undone except by restoring a backup.`,
        strong: true,
      });
      if (!proceed) return;

      await createSafetyBackup(guild, interaction.user.id, `before deleting category ${category.name}`);

      let deletedChannelCount = 0;
      if (deleteChannels) {
        for (const child of toDelete.values()) {
          await child.delete(`Bulk-deleted with parent category by ${interaction.user.tag} via /tun-category delete`).catch(() => undefined);
          deletedChannelCount++;
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      let categoryDeleted = false;
      if (!keepsCategory) {
        const ch = await guild.channels.fetch(category.id);
        await ch?.delete(`Deleted by ${interaction.user.tag} via /tun-category delete`);
        categoryDeleted = true;
      }

      const summary = keepsCategory
        ? `Deleted ${deletedChannelCount} channel(s) from "${category.name}". Category kept (${toKeep.size} protected channel(s) remain inside).`
        : deleteChannels
        ? `${category.name} + ${deletedChannelCount} channel(s) inside it`
        : category.name;

      await interaction.editReply({ embeds: [successEmbed(categoryDeleted ? "Category deleted" : "Channels deleted", summary)] });
      return { target: category.name, details: { deleteChannels, deletedChannelCount, protectedCount: toKeep.size, categoryDeleted } };
    }

    if (sub === "rename") {
      const category = interaction.options.getChannel("category", true);
      const newName = interaction.options.getString("new_name", true);
      const ch: any = await guild.channels.fetch(category.id);
      const oldName = ch.name;
      await ch.setName(newName, `Renamed by ${interaction.user.tag} via /tun-category rename`);
      await interaction.editReply({ embeds: [successEmbed("Category renamed", `${oldName} → ${newName}`)] });
      return { target: newName, details: { oldName } };
    }

    if (sub === "move") {
      const category = interaction.options.getChannel("category", true);
      const position = interaction.options.getInteger("position", true);
      const ch: any = await guild.channels.fetch(category.id);
      await ch.setPosition(position, { reason: `Moved by ${interaction.user.tag} via /tun-category move` });
      await interaction.editReply({ embeds: [successEmbed("Category moved", `${category.name} → position ${position}`)] });
      return { target: category.name };
    }
  });
}
