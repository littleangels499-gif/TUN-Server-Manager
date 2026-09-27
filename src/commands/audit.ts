import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { guardGuildAdmin, safeExecute } from "../utils/commandHelpers";
import { baseEmbed } from "../utils/embed";
import { queryAuditLog } from "../services/auditService";

export const commandName = "tun-audit";

export function register(): SlashCommandBuilder {
  const cmd = new SlashCommandBuilder().setName("tun-audit").setDescription("View and search the administrative action log");
  cmd
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View recent audit log entries")
        .addIntegerOption((opt) => opt.setName("limit").setDescription("How many entries (default 15, max 25)").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("search")
        .setDescription("Search the audit log")
        .addStringOption((opt) => opt.setName("command").setDescription("Filter by command, e.g. 'blueprint restore'").setRequired(false))
        .addUserOption((opt) => opt.setName("user").setDescription("Filter by who ran the command").setRequired(false))
    );
  return cmd;
}

function formatEntry(e: { userId: string; command: string; target: string | null; success: boolean; createdAt: Date; errorMsg: string | null }) {
  const status = e.success ? "✅" : "❌";
  const targetStr = e.target ? ` → \`${e.target}\`` : "";
  const errStr = e.errorMsg ? `\n   ⚠️ ${e.errorMsg}` : "";
  return `${status} <t:${Math.floor(e.createdAt.getTime() / 1000)}:R> <@${e.userId}> \`/tun ${e.command}\`${targetStr}${errStr}`;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await guardGuildAdmin(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  await safeExecute(interaction, `audit ${sub}`, async () => {
    if (sub === "view") {
      const limit = Math.min(interaction.options.getInteger("limit") ?? 15, 25);
      const entries = await queryAuditLog(guildId, { limit });
      const embed = baseEmbed(`📋 Audit Log (last ${entries.length})`).setDescription(
        entries.length ? entries.map(formatEntry).join("\n\n").slice(0, 4000) : "No audit entries yet."
      );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "search") {
      const command = interaction.options.getString("command") ?? undefined;
      const user = interaction.options.getUser("user");
      const entries = await queryAuditLog(guildId, { limit: 25, command, userId: user?.id });
      const embed = baseEmbed(`🔎 Audit Search (${entries.length} result${entries.length === 1 ? "" : "s"})`).setDescription(
        entries.length ? entries.map(formatEntry).join("\n\n").slice(0, 4000) : "No matching audit entries."
      );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  });
}
