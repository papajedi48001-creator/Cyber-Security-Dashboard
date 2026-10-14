import { PrismaClient } from "@prisma/client";

/** MariaDB integration tests run only when TEST_DATABASE_URL points at a disposable database. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export function testPrisma(): PrismaClient {
  return testDatabaseUrl
    ? new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } })
    : (undefined as unknown as PrismaClient);
}
