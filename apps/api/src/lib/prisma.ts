import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../config/env';
import { pgConnectionConfig } from './db-connection';

export function createPrisma(connectionString: string, sslCa?: string) {
  return new PrismaClient({ adapter: new PrismaPg(pgConnectionConfig(connectionString, sslCa)) });
}

export const prisma = createPrisma(env.DATABASE_URL, env.DATABASE_SSL_CA);
export type Db = typeof prisma;
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
