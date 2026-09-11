import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  _prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/**
 * Get the Prisma client (lazy initialization)
 * This allows the build to complete without DATABASE_URL
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma._prisma) {
    globalForPrisma._prisma = createPrismaClient();
  }
  return globalForPrisma._prisma;
}

// For backwards compatibility - will throw at import time if DATABASE_URL is missing
// Use getPrisma() instead for lazy initialization
export const prisma = (() => {
  // Skip initialization during build
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return null as unknown as PrismaClient;
  }
  return getPrisma();
})();
