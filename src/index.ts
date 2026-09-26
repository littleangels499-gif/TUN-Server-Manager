import { Events, Interaction } from "discord.js";
import { env } from "./config";
import { logger } from "./logger";
import { createDiscordClient } from "./discord/client";
import { findModule } from "./commands";
import { ensureGuild } from "./services/authService";
import { errorEmbed } from "./utils/embed";

const client = createDiscordClient();

client.once(Events.ClientReady, (c) => {
  logger.info(`TUN Server Manager online as ${c.user.tag} (in ${c.guilds.cache.size} server(s))`);
});

// Keep our Guild table in sync with reality (spec #18: multi-server, fully
// isolated per-guild data).
client.on(Events.GuildCreate, async (guild) => {
  await ensureGuild(guild.id, guild.name);
  logger.info(`Joined guild: ${guild.name} (${guild.id})`);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (interaction.isAutocomplete()) {
    const mod = findModule(interaction);
    if (mod?.autocomplete) {
      try {
        await mod.autocomplete(interaction);
      } catch (err) {
        logger.error({ err }, "Autocomplete handler failed");
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "tun") return;

  if (interaction.guildId) await ensureGuild(interaction.guildId, interaction.guild?.name);

  const mod = findModule(interaction);
  if (!mod) {
    await interaction.reply({ embeds: [errorEmbed("Unknown command.")], ephemeral: true });
    return;
  }

  try {
    await mod.execute(interaction);
  } catch (err) {
    // Last-resort catch - individual command modules already handle their
    // own errors via safeExecute(), but this guarantees the interaction
    // never hangs even if a module forgets to.
    logger.error({ err }, "Unhandled command error");
    const embed = errorEmbed("An unexpected error occurred. This has been logged.");
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ embeds: [embed] }).catch(() => undefined);
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => undefined);
    }
  }
});

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Unhandled promise rejection");
});

client.login(env.DISCORD_TOKEN);
