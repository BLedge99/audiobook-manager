/**
 * The minimal surface Prisma's interactive transactions expose.
 *
 * Helpers that participate in a `prisma.$transaction(...)` receive the
 * transaction client, which is not assignable to `PrismaClient`. Widening the
 * parameter to this union lets one helper serve both the transactional and
 * the standalone call sites.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export type PrismaLike = PrismaClient | Prisma.TransactionClient;
