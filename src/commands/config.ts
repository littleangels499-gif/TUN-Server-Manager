import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { addAdminRole, addAdminUser, getAdminConfig, removeAdminRole, removeAdminUser } from "../services/authService";
import { baseEmbed, successEmbed } from "../utils/embed";

export const key = "config";

export function register(tun: SlashCommandBuilder) {
  tun.addSubcommandGroup((group) =>
    group
      .setName("config")
      .setDescription("Configure who can use TUN Server Manager admin commands (spec #14)")
      .addSubcommand((sub) => sub.setName("view").setDescription("Show configured admin roles/users"))
      .addSubcommand((sub) =>
        sub
          .setName("set-admin-role")
          .setDescription("Authorize a role to use admin commands")
          .addRoleOption((opt) => opt.setName("role").setDescription("Role to authorize").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove-admin-role")
          .setDescription("Revoke a role's admin access")
          .addRoleOption((opt) => opt.setName("role").setDescription("Role to revoke").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("set-admin-user")
          .setDescription("Authorize a specific user to use admin commands")
          .addUserOption((opt) => opt.setName("user").setDescription("User to authorize").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove-admin-user")
          .setDescription("Revoke a specific user's admin access")
          .addUserOption((opt) => opt.setName("user").setDescription("User to revoke").setRequired(true))
      )
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  // Config changes are themselves security-sensitive, so require Discord
  // Administrator or existing bot-admin status, same as everything else.
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();

  await safeExecute(interaction, `config ${sub}`, async () => {
    const guildId = interaction.guildId!;

    if (sub === "view") {
      const { adminRoleIds, adminUserIds } = await getAdminConfig(guildId);
      const embed = baseEmbed("🛠️ Admin Configuration").addFields(
        { name: "Admin roles", value: adminRoleIds.length ? adminRoleIds.map((id) => `<@&${id}>`).join(", ") : "None configured" },
        { name: "Admin users", value: adminUserIds.length ? adminUserIds.map((id) => `<@${id}>`).join(", ") : "None configured" },
        { name: "Always authorized", value: "Anyone with the native **Administrator** permission" }
      );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "set-admin-role") {
      const role = interaction.options.getRole("role", true);
      await addAdminRole(guildId, role.id);
      await interaction.reply({ embeds: [successEmbed("Role authorized", `${role} can now use TUN admin commands.`)], ephemeral: true });
      return { target: role.id };
    }

    if (sub === "remove-admin-role") {
      const role = interaction.options.getRole("role", true);
      await removeAdminRole(guildId, role.id);
      await interaction.reply({ embeds: [successEmbed("Role revoked", `${role} can no longer use TUN admin commands.`)], ephemeral: true });
      return { target: role.id };
    }

    if (sub === "set-admin-user") {
      const user = interaction.options.getUser("user", true);
      await addAdminUser(guildId, user.id);
      await interaction.reply({ embeds: [successEmbed("User authorized", `${user} can now use TUN admin commands.`)], ephemeral: true });
      return { target: user.id };
    }

    if (sub === "remove-admin-user") {
      const user = interaction.options.getUser("user", true);
      await removeAdminUser(guildId, user.id);
      await interaction.reply({ embeds: [successEmbed("User revoked", `${user} can no longer use TUN admin commands.`)], ephemeral: true });
      return { target: user.id };
    }
  });
}
