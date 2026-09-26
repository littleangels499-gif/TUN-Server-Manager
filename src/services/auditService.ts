import { prisma } from "../db/prisma";
import { logger } from "../logger";

export interface AuditEntryInput {
  guildId: string;
  userId: string;
  command: string;
  target?: string;
  details?: Record<string, unknown>;
  success: boolean;
  errorMsg?: string;
}

/**
 * Spec #13: log administrative actions including user, command, target,
 * timestamp, changes and success/failure. Errors must be clearly reported,
 * never silently swallowed.
 *
 * Writes to our own DB rather than relying on Discord's audit log, because
 * Discord's audit log only reliably retains ~45 days and doesn't capture
 * bot-specific context like "which Blueprint" or "dry-run vs real".
 */
export async function logAudit(entry: AuditEntryInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        guildId: entry.guildId,
        userId: entry.userId,
        command: entry.command,
        target: entry.target,
        details: entry.details ? JSON.stringify(entry.details) : undefined,
        success: entry.success,
        errorMsg: entry.errorMsg,
      },
    });
  } catch (err) {
    // Audit logging must never crash the bot, but it must be loud in the
    // server logs if it fails - a silent audit failure defeats the point.
    logger.error({ err, entry }, "Failed to write audit log entry");
  }
}

export async function queryAuditLog(
  guildId: string,
  opts: { limit?: number; command?: string; userId?: string } = {}
) {
  return prisma.auditLog.findMany({
    where: {
      guildId,
      command: opts.command ? { contains: opts.command } : undefined,
      userId: opts.userId,
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 20,
  });
}
