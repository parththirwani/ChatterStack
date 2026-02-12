import NextAuth, { DefaultSession } from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "./prisma"
import GoogleProvider from "next-auth/providers/google"
import GitHubProvider from "next-auth/providers/github"
import { JWT } from "next-auth/jwt"

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string
      provider?: string
    } & DefaultSession["user"]
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email || !account) return false
      
      try {
        // Check if user exists
        let dbUser = await prisma.user.findUnique({
          where: { providerId: account.providerAccountId },
        })

        // Create or update user
        if (!dbUser) {
          dbUser = await prisma.user.create({
            data: {
              provider: account.provider,
              providerId: account.providerAccountId,
              email: user.email,
              name: user.name,
              avatarUrl: user.image,
            },
          })
        } else {
          // Update user info if changed
          if (dbUser.name !== user.name || dbUser.avatarUrl !== user.image) {
            await prisma.user.update({
              where: { id: dbUser.id },
              data: {
                name: user.name,
                avatarUrl: user.image,
              },
            })
          }
        }

        return true
      } catch (error) {
        console.error("SignIn error:", error)
        return false
      }
    },

    async jwt({ token, account, user }) {
      if (account && user) {
        // First sign in
        const dbUser = await prisma.user.findUnique({
          where: { providerId: account.providerAccountId },
        })

        if (dbUser) {
          token.id = dbUser.id
          token.provider = dbUser.provider
        }
      }

      return token
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.provider = token.provider as string
      }

      return session
    },
  },
  pages: {
    signIn: "/",
    error: "/",
  },
})