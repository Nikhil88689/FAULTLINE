import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const prismaGlobal = globalThis as unknown as { prisma?: PrismaClient };

export function getPrismaClient(): PrismaClient | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  if (!prismaGlobal.prisma) {
    prismaGlobal.prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString, max: 1 }),
    });
  }

  return prismaGlobal.prisma;
}
