import { PrismaClient } from "@prisma/client";

// Standard singleton pattern to avoid exhausting DB connections when the
// dev server hot-reloads (tsx watch).
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
