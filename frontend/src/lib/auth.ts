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
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
        },
      },
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
          provider: 'google',
          providerId: profile.sub,
        };
      },
    }),
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      profile(profile) {
        return {
          id: profile.id.toString(),
          name: profile.name || profile.login,
          email: profile.email,
          image: profile.avatar_url,
          provider: 'github',
          providerId: profile.id.toString(),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        token.provider = account?.provider || user.provider || 'unknown';
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
    async signIn({ user, account, profile }) {
      if (!account) return false;

      try {
        // Check if user exists by provider ID
        const existingUser = await prisma.user.findFirst({
          where: {
            provider: account.provider,
            providerId: account.providerAccountId,
          },
        });

        if (existingUser) {
          // Update user info if needed
          await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              name: user.name || existingUser.name,
              avatarUrl: user.image || existingUser.avatarUrl,
              email: user.email || existingUser.email,
              updatedAt: new Date(),
            },
          });
        } else {
          // Check if email exists with different provider
          const emailUser = await prisma.user.findUnique({
            where: { email: user.email || '' },
          });

          if (emailUser) {
            // Link accounts by updating provider info
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
          } else {
            // Create new user
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
          }
        }

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