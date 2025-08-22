import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { Profile as GoogleProfile } from "passport-google-oauth20";
import type { VerifyCallback } from "passport-oauth2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const googleStrategy = new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL: "/auth/google/callback",
  },
  async (
    accessToken: string,
    refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback
  ) => {
    try {
      let user = await prisma.user.findUnique({ where: { providerId: profile.id } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            provider: "google",
            providerId: profile.id,
            email: profile.emails?.[0]?.value,
            name: profile.displayName,
            avatarUrl: profile.photos?.[0]?.value,
          },
        });
      }
      return done(null, user);
    } catch (err) {
      return done(err as Error, undefined);
    }
  }
);
