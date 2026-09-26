import { AutocompleteInteraction, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import * as help from "./help";
import * as config from "./config";
import * as category from "./category";
import * as channel from "./channel";
import * as role from "./role";
import * as permission from "./permission";
import * as blueprint from "./blueprint";
import * as backup from "./backup";
import * as audit from "./audit";
import * as embassy from "./embassy";
import * as server from "./server";

export interface CommandModule {
  key: string;
  register: (tun: SlashCommandBuilder) => void;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

// Every module here contributes one subcommand-group (or, for help, one
// bare top-level subcommand) to the single /tun command, per the spec #21
// command architecture.
export const modules: CommandModule[] = [
  help as CommandModule,
  config as CommandModule,
  category as CommandModule,
  channel as CommandModule,
  role as CommandModule,
  permission as CommandModule,
  blueprint as CommandModule,
  backup as CommandModule,
  audit as CommandModule,
  embassy as CommandModule,
  server as CommandModule,
];

export function buildTunCommand(): SlashCommandBuilder {
  const tun = new SlashCommandBuilder()
    .setName("tun")
    .setDescription("TUN Server Manager - server architecture, blueprints, backups & recovery");

  for (const mod of modules) {
    mod.register(tun);
  }

  return tun;
}

export function findModule(interaction: ChatInputCommandInteraction | AutocompleteInteraction): CommandModule | undefined {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  const key = group ?? sub;
  return modules.find((m) => m.key === key);
}
