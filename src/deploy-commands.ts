import { REST, Routes } from "discord.js";
import { env } from "./config";
import { buildTunCommand } from "./commands";
import { logger } from "./logger";

/**
 * Registers the /tun command tree with Discord.
 *
 * - Default (no flag): registers to DEV_GUILD_ID if set - guild-scoped
 *   commands update INSTANTLY, which is what you want while developing.
 * - `--global`: registers globally (propagates to all servers in up to ~1
 *   hour). Use this for the production/Railway deployment.
 */
async function main() {
  const forceGlobal = process.argv.includes("--global");
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  const command = buildTunCommand().toJSON();

  if (!forceGlobal && env.DEV_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DEV_GUILD_ID), { body: [command] });
    logger.info(`Registered /tun to guild ${env.DEV_GUILD_ID} (instant).`);
  } else {
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: [command] });
    logger.info("Registered /tun globally (may take up to ~1 hour to propagate to all servers).");
  }
}

main().catch((err) => {
  logger.error({ err }, "Failed to deploy commands");
  process.exit(1);
});
