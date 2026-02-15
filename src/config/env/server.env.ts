export const serverEnv = {
  databaseUrl: process.env.DATABASE_URL!,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
  openrouterApiKey: process.env.OPENROUTER_API_KEY!,
} as const;