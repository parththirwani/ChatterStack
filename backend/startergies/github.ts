import { Strategy as GitHubStrategy, type Profile } from "passport-github2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const githubStrategy = new GitHubStrategy(
  {
    clientID: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    callbackURL: process.env.GITHUB_CALLBACK_URL!,
    scope: ["user:email"],
  },
  async (accessToken: string, _refreshToken: string, profile: Profile, done: (err: any, user?: any) => void) => {
    try {
      let email: string | null = (profile as any).emails?.[0]?.value || null;

      if (!email) {
        const res = await fetch("https://api.github.com/user/emails", {
          headers: { Authorization: `token ${accessToken}` },
        });
        const emails = (await res.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email || null;
      }

      let user = await prisma.user.findUnique({ where: { providerId: profile.id } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            provider: "github",
            providerId: profile.id,
            email,
            name: profile.displayName,
            avatarUrl: profile.photos?.[0]?.value,
          },
        });
      }

      return done(null, user);
    } catch (err) {
      return done(err, null);
    }
  }
);
