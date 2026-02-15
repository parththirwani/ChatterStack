import { PrismaPg } from '@prisma/adapter-pg';
import { getPostgresPool } from './pool';

export function createPrismaAdapter() {
  const pool = getPostgresPool();
  return new PrismaPg(pool);
}