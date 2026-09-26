import { EmbedBuilder } from "discord.js";

export const COLORS = {
  info: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  neutral: 0x2b2d31,
} as const;

export function baseEmbed(title: string, color: number = COLORS.info): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setColor(color).setTimestamp();
}

export function errorEmbed(message: string): EmbedBuilder {
  return baseEmbed("❌ Error", COLORS.danger).setDescription(message);
}

export function successEmbed(title: string, description?: string | null): EmbedBuilder {
  const e = baseEmbed(`✅ ${title}`, COLORS.success);
  if (description) e.setDescription(description);
  return e;
}

/** Splits long text into embed-field-safe chunks (Discord field value cap: 1024 chars). */
export function chunkText(text: string, size = 1000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length ? chunks : [""];
}