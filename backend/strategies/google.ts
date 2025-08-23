import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { Profile as GoogleProfile } from "passport-google-oauth20";
import type { VerifyCallback } from "passport-oauth2";
import { prisma } from "../lib/prisma";

export const googleStrategy = new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL: `${process.env.BACKEND_URL || "http://localhost:3000"}/auth/google/callback`,
  },
  async (
    accessToken: string,
    _refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback
  ) => {
    try {
      // Extract avatar
      let avatarUrl: string | null = null;

      if (profile.photos?.[0]?.value) {
        avatarUrl = profile.photos[0].value;
      } else if ((profile as any)._json?.picture) {
        avatarUrl = (profile as any)._json.picture;
      }

      // Normalize Google avatar (remove size param or upscale)
      if (avatarUrl) {
        avatarUrl = avatarUrl.replace(/=s\d+-c$/, "=s400-c");
      }

      let user = await prisma.user.findUnique({
        where: { providerId: profile.id },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            provider: "google",
            providerId: profile.id,
            email: profile.emails?.[0]?.value || null,
            name: profile.displayName || null,
            avatarUrl,
          },
        });
      } else if (!user.avatarUrl && avatarUrl) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { avatarUrl },
        });
      }

      return done(null, user);
    } catch (err) {
      return done(err as Error, undefined);
    }
  }
);
