import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { baseEmbed } from "../utils/embed";
import { safeExecute } from "../utils/commandHelpers";

export const key = "help";

const CATEGORIES: Record<string, { title: string; lines: string[] }> = {
  structure: {
    title: "📐 Server Structure",
    lines: [
      "`/tun category create|delete|rename|move|list` - manage categories (delete has a `delete_channels` option to also remove everything inside)",
      "`/tun channel create|delete|rename|move|edit|list` - manage channels",
      "`/tun server wipe` - delete EVERY category/channel, with up to 5 `protect_` slots to keep specific items (and anything inside a protected category)",
    ],
  },
  roles: {
    title: "🎭 Roles",
    lines: ["`/tun role create|delete|edit|position|list` - manage roles (colour, hoist, mentionable, permissions, position)"],
  },
  permissions: {
    title: "🔐 Permissions",
    lines: [
      "`/tun permission set|remove|view` - role/user overwrites on a category or channel (Allow/Deny/Inherit)",
      "`/tun permission template save|apply|list` - reusable permission templates",
    ],
  },
  blueprints: {
    title: "🗺️ Blueprints",
    lines: [
      "`/tun blueprint save` - snapshot the current supported structure under a name",
      "`/tun blueprint create-empty` - start a blank blueprint with NO live server needed",
      "`/tun blueprint add-category|add-channel|add-role` - build a blueprint's structure from scratch",
      "`/tun blueprint set-role-permission|set-everyone-permission|add-overwrite` - define permissions within a blueprint before it ever touches a server",
      "`/tun blueprint list|view|rename|delete` - manage saved blueprints",
      "`/tun blueprint compare` - preview live server vs a blueprint (no changes made)",
      "`/tun blueprint restore` - preview + confirm restoring a blueprint (recreates roles, channels, categories AND their permission overwrites)",
      "`/tun blueprint import|export` - portable JSON blueprint files",
    ],
  },
  backups: {
    title: "🛟 Backups",
    lines: [
      "`/tun backup create|list|view|delete` - manage disaster-recovery backups",
      "`/tun backup restore` - preview + confirm restoring a backup",
      "`/tun backup rollback` - undo the last restore using the automatic safety backup",
    ],
  },
  safety: {
    title: "🧯 Safety & Recovery",
    lines: [
      "All destructive commands (delete/restore/reset/import) show a preview and require explicit confirmation.",
      "Major structural changes automatically create a safety backup first.",
      "`/tun audit view|search` - see who did what, when",
    ],
  },
  administration: {
    title: "🛠️ Administration",
    lines: [
      "`/tun config view` - see who is authorized to use admin commands",
      "`/tun config set-admin-role|remove-admin-role` - grant/revoke a role",
      "`/tun config set-admin-user|remove-admin-user` - grant/revoke a specific user",
      "`/tun embassy add|remove|list` - map embassy channels to external alliance roles",
    ],
  },
};

export function register(tun: SlashCommandBuilder) {
  tun.addSubcommand((sub) =>
    sub
      .setName("help")
      .setDescription("Show TUN Server Manager help")
      .addStringOption((opt) =>
        opt
          .setName("category")
          .setDescription("Jump to a specific help category")
          .setRequired(false)
          .addChoices(
            { name: "Server Structure", value: "structure" },
            { name: "Roles", value: "roles" },
            { name: "Permissions", value: "permissions" },
            { name: "Blueprints", value: "blueprints" },
            { name: "Backups", value: "backups" },
            { name: "Safety & Recovery", value: "safety" },
            { name: "Administration", value: "administration" }
          )
      )
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await safeExecute(interaction, "help", async () => {
    const category = interaction.options.getString("category");

    if (category && CATEGORIES[category]) {
      const c = CATEGORIES[category];
      const embed = baseEmbed(c.title).setDescription(c.lines.join("\n\n"));
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return { target: category };
    }

    const embed = baseEmbed("🤖 TUN Server Manager - Help").setDescription(
      "Server architecture, blueprints, backups & recovery for authorized TUN administrators.\n\n" +
        "Run `/tun help category:<name>` for details on a category, or browse below."
    );
    for (const [, c] of Object.entries(CATEGORIES)) {
      embed.addFields({ name: c.title, value: c.lines.map((l) => `• ${l}`).join("\n").slice(0, 1024) });
    }
    embed.setFooter({ text: "Destructive commands always preview changes and ask for confirmation first." });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  });
}