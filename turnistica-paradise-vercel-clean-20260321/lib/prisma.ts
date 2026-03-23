import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function firstEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }

  return "";
}

const resolvedDirectUrl = firstEnv(
  "DIRECT_URL",
  "POSTGRES_URL_NON_POOLING",
  "SUPABASE_DIRECT_URL",
  "NETLIFY_DATABASE_URL_UNPOOLED"
);
const resolvedDatabaseUrl =
  firstEnv(
    "DATABASE_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL",
    "SUPABASE_DATABASE_URL"
  ) ||
  resolvedDirectUrl ||
  firstEnv("NETLIFY_DATABASE_URL", "NETLIFY_DATABASE_URL_UNPOOLED");

if (!process.env.DATABASE_URL && resolvedDatabaseUrl) {
  process.env.DATABASE_URL = resolvedDatabaseUrl;
}

if (!process.env.DIRECT_URL && resolvedDirectUrl) {
  process.env.DIRECT_URL = resolvedDirectUrl;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: resolvedDatabaseUrl ? { db: { url: resolvedDatabaseUrl } } : undefined,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
