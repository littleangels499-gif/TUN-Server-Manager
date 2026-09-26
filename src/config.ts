import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DEV_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BOT_OWNER_IDS: z.string().optional().default(""),
  LOG_LEVEL: z.string().optional().default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail loudly and early rather than limping along with undefined secrets.
  console.error("Invalid or missing environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\nCopy .env.example to .env and fill in the values.");
  process.exit(1);
}

export const env = parsed.data;

export const botOwnerIds: string[] = env.BOT_OWNER_IDS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
