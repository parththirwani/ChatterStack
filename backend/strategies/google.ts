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
      let avatarUrl: string | null = null;

      if (profile.photos?.[0]?.value) {
        avatarUrl = profile.photos[0].value;
      }

      if (!avatarUrl && (profile as any)._json?.picture) {
        avatarUrl = (profile as any)._json.picture;
      }

      if (!avatarUrl) {
        const altSources = [
          (profile as any).picture,
          (profile as any).image,
          (profile as any)._json?.image,
          (profile as any)._json?.avatar_url,
        ];
        
        for (let i = 0; i < altSources.length; i++) {
          if (altSources[i]) {
            avatarUrl = altSources[i];
            break;
          }
        }
      }

      if (avatarUrl) {
        avatarUrl = avatarUrl.replace(/=s\d+-c$/, "=s400-c");
        if (avatarUrl.includes("googleusercontent.com")) {
          avatarUrl = avatarUrl.replace(/=s\d+-c$/, "").replace(/=s\d+$/, "");
        }
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
) as any;
