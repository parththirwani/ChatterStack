import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '../database/prisma';
import { getProviders } from './providers';
import { getCallbacks } from './callbacks';

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