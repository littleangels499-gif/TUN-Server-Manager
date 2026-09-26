import { ChatInputCommandInteraction } from "discord.js";
import { isAuthorizedAdmin } from "../services/authService";
import { logAudit } from "../services/auditService";
import { errorEmbed } from "./embed";
import { logger } from "../logger";

/**
 * Every command handler should call this first. Returns false (and already
 * replies to the user) if the command can't proceed - guild-only, must be
 * a GuildMember, and must pass spec #14 authorization.
 */
export async function guardGuildAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
    await interaction.reply({ embeds: [errorEmbed("This command can only be used inside a server.")], ephemeral: true });
    return false;
  }

  const member = interaction.member;
  // interaction.member can be an APIInteractionGuildMember when not cached;
  // fetch the full GuildMember to reliably check roles/permissions.
  const fullMember = "roles" in member && "permissions" in member && typeof (member as any).roles?.cache !== "undefined"
    ? (member as any)
    : await interaction.guild.members.fetch(interaction.user.id);

  const authorized = await isAuthorizedAdmin(fullMember);
  if (!authorized) {
    await interaction.reply({
      embeds: [errorEmbed("You are not authorized to use TUN Server Manager admin commands. Ask a server administrator to grant you access via `/tun config`.")],
      ephemeral: true,
    });
    return false;
  }
  return true;
}

/**
 * Wraps a command body so errors are always caught, reported to the user
 * clearly (spec #13: "errors must be clearly reported rather than silently
 * ignored"), and logged to the audit trail with success=false.
 */
export async function safeExecute(
  interaction: ChatInputCommandInteraction,
  commandLabel: string,
  fn: () => Promise<{ target?: string | null; details?: Record<string, unknown> } | void>
): Promise<void> {
  try {
    const result = (await fn()) ?? {};
    await logAudit({
      guildId: interaction.guildId!,
      userId: interaction.user.id,
      command: commandLabel,
      target: result.target ?? undefined,
      details: result.details,
      success: true,
    });
  } catch (err: any) {
    logger.error({ err, commandLabel }, "Command failed");
    const message = err?.message ? String(err.message) : "An unexpected error occurred.";
    const embed = errorEmbed(message);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed], components: [] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    } catch {
      // interaction may have expired - nothing more we can do
    }
    await logAudit({
      guildId: interaction.guildId!,
      userId: interaction.user.id,
      command: commandLabel,
      success: false,
      errorMsg: message,
    });
  }
}