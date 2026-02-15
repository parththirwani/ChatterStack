import { PrismaAdapter } from '@auth/prisma-adapter';
import { getProviders } from './providers';
import { getCallbacks } from './callbacks';
import { prisma } from '../database/prisma/client';

export const authConfig = {
  adapter: PrismaAdapter(prisma),
  providers: getProviders(),
  callbacks: getCallbacks(),
  pages: {
    signIn: '/',
    error: '/',
  },
  session: {
    strategy: 'database',
  },
  trustHost: true,
};