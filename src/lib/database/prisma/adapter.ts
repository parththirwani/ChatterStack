// Extract: PrismaPg adapter
import { PrismaPg } from '@prisma/adapter-pg';
import { getPostgresPool } from '../postgres/pool';

export function createPrismaAdapter() {
  const pool = getPostgresPool();
  return new PrismaPg(pool);
}