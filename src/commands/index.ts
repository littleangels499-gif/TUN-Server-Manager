import { AutocompleteInteraction, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import * as help from "./help";
import * as config from "./config";
import * as category from "./category";
import * as channel from "./channel";
import * as role from "./role";
import * as permission from "./permission";
import * as blueprint from "./blueprint";
import * as blueprintBuild from "./blueprintBuild";
import * as backup from "./backup";
import * as audit from "./audit";
import * as embassy from "./embassy";
import * as server from "./server";

export interface CommandModule {
  /** The exact top-level Discord command name this module owns, e.g. "tun-category". */
  commandName: string;
  register: () => SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

// Each module is now its OWN top-level Discord command (not a subcommand
// group under one shared "/tun"). This is a deliberate split: Discord caps
// a single command's total JSON size at 8000 characters, and the full
// feature set no longer fits in one command. Splitting by feature area
// keeps every individual command comfortably under that limit and scales
// cleanly as more features get added later.
export const modules: CommandModule[] = [
  help as CommandModule,
  config as CommandModule,
  category as CommandModule,
  channel as CommandModule,
  role as CommandModule,
  permission as CommandModule,
  blueprint as CommandModule,
  blueprintBuild as CommandModule,
  backup as CommandModule,
  audit as CommandModule,
  embassy as CommandModule,
  server as CommandModule,
];

export function buildAllCommands(): SlashCommandBuilder[] {
  return modules.map((m) => m.register());
}

export function findModule(interaction: ChatInputCommandInteraction | AutocompleteInteraction): CommandModule | undefined {
  return modules.find((m) => m.commandName === interaction.commandName);
}
