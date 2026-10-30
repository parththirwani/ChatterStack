import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";
import { providerIdentityUpdate } from "./server/provider-profile";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

export const { handlers, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  pages: {
    signIn: "/",
    error: "/", 
  },
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async signIn({ user, profile }) {
      // Auth.js keeps the profile it saw when the account was created. Refresh
      // the name and photo on every sign-in so a new Google/GitHub photo shows
      // up without touching the database by hand.
      if (!user.id) return true;
      const update = providerIdentityUpdate(user, profile);
      if (!update.name && !update.image) return true;

      try {
        await prisma.user.update({ where: { id: user.id }, data: update });
      } catch (error) {
        // A stale avatar is not worth failing the sign-in over.
        console.error('[auth] Could not refresh the provider profile', error);
      }
      return true;
    },
    async session({ session, user }) {
      // Auth.js can pass adapter fields through `session`. Return an explicit
      // browser shape so the database session token never reaches the client.
      return {
        expires: session.expires,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      };
    },
  },
  // CRITICAL: These settings fix the Configuration error
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  debug: process.env.NODE_ENV === "development",
});
