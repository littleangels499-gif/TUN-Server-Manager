import { Client, GatewayIntentBits, Partials } from "discord.js";

/**
 * Intents kept deliberately minimal. This bot manages structure, roles and
 * permissions - it never needs to read message content or DM content, so we
 * don't request those privileged intents. Fewer intents also means less to
 * justify if TUN ever needs to verify the bot for 100+ server use.
 */
export function createDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember],
  });
}
