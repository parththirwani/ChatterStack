import NextAuth, { DefaultSession } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from './prisma';
import GoogleProvider from 'next-auth/providers/google';
import GithubProvider from 'next-auth/providers/github';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      provider?: string;
    } & DefaultSession['user'];
  }
  
  interface User {
    provider?: string;
    providerId?: string;
    avatarUrl?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: '/', // Redirect to home page for signin
    error: '/', // Redirect to home page on error
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        token.provider = account?.provider || 'unknown';
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.provider = token.provider as string;
      }
      return session;
    },
    async signIn({ user, account }) {
      if (!account) return false;

      try {
        const existingUser = await prisma.user.findFirst({
          where: {
            provider: account.provider,
            providerId: account.providerAccountId,
          },
        });

        if (existingUser) {
          await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              name: user.name || existingUser.name,
              avatarUrl: user.image || existingUser.avatarUrl,
              email: user.email || existingUser.email,
              updatedAt: new Date(),
            },
          });
          return true;
        }

        const emailUser = user.email ? await prisma.user.findUnique({
          where: { email: user.email },
        }) : null;

        if (emailUser) {
          await prisma.user.update({
            where: { id: emailUser.id },
            data: {
              provider: account.provider,
              providerId: account.providerAccountId,
              name: user.name || emailUser.name,
              avatarUrl: user.image || emailUser.avatarUrl,
              updatedAt: new Date(),
            },
          });
          return true;
        }

        await prisma.user.create({
          data: {
            email: user.email!,
            name: user.name,
            avatarUrl: user.image,
            provider: account.provider,
            providerId: account.providerAccountId,
            profile: {},
            profileUpdated: new Date(),
          },
        });

        return true;
      } catch (error) {
        console.error('Sign in error:', error);
        return false;
      }
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === 'development',
});