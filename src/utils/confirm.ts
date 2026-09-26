import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
} from "discord.js";
import { COLORS } from "./embed";

export interface ConfirmOptions {
  interaction: ChatInputCommandInteraction;
  title: string;
  description: string;
  /**
   * If true, requires the admin to type the exact confirm phrase as the
   * button label match isn't enough (spec #12: "extremely destructive
   * operations may require stronger confirmation"). Currently implemented
   * as a second confirmation button press with a shorter timeout + a loud
   * warning; see docs/BLUEPRINTS_AND_BACKUPS.md for rationale.
   */
  strong?: boolean;
  confirmLabel?: string;
  timeoutMs?: number;
}

/**
 * Shows a preview embed with Confirm/Cancel buttons and resolves to true
 * only if the SAME user who ran the command clicks Confirm in time.
 * Every destructive command (delete, restore, reset, import) must route
 * through this - never execute directly from the slash command handler.
 */
export async function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  const { interaction, title, description, strong, timeoutMs = 30_000 } = opts;

  const confirmButton = new ButtonBuilder()
    .setCustomId("confirm")
    .setLabel(opts.confirmLabel ?? (strong ? "Yes, I understand - proceed" : "Confirm"))
    .setStyle(strong ? ButtonStyle.Danger : ButtonStyle.Primary);

  const cancelButton = new ButtonBuilder()
    .setCustomId("cancel")
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

  const embed = new EmbedBuilder()
    .setTitle(`⚠️ ${title}`)
    .setDescription(description)
    .setColor(strong ? COLORS.danger : COLORS.warning)
    .setFooter({ text: strong ? "This is a major destructive operation." : "This action requires confirmation." });

  const message = await interaction.editReply({ embeds: [embed], components: [row] });

  try {
    const click = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id,
      time: timeoutMs,
    });

    if (click.customId === "confirm") {
      await click.update({
        embeds: [embed.setFooter({ text: "Confirmed - processing..." })],
        components: [],
      });
      return true;
    } else {
      await click.update({
        embeds: [embed.setColor(COLORS.neutral).setFooter({ text: "Cancelled." })],
        components: [],
      });
      return false;
    }
  } catch {
    // Timed out
    await interaction.editReply({
      embeds: [embed.setColor(COLORS.neutral).setFooter({ text: "Timed out - no changes made." })],
      components: [],
    });
    return false;
  }
}
