import { PrismaAdapter } from '@auth/prisma-adapter';
import { getProviders } from './providers';
import { getCallbacks } from './callbacks';
import { prisma } from '../database/prisma/client';
import type { NextAuthConfig } from 'next-auth';

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  providers: getProviders(),
  callbacks: getCallbacks(),
  pages: {
    signIn: '/',
    error: '/',
  },
  session: {
    strategy: 'database' as const, // Explicitly type as const
  },
  trustHost: true,
};