import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { Profile as GoogleProfile } from "passport-google-oauth20";
import type { VerifyCallback } from "passport-oauth2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const googleStrategy = new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL: `${process.env.BACKEND_URL || "http://localhost:3000"}/auth/google/callback`,
  },
  async (
    accessToken: string,
    refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback
  ) => {
    try {
      // Debug: Log the profile to see what data we're getting
      console.log("Google profile received:", {
        id: profile.id,
        displayName: profile.displayName,
        emails: profile.emails,
        photos: profile.photos,
        _json: profile._json // This contains the raw Google response
      });

      // Extract avatar URL with fallbacks
      let avatarUrl: string | null = null;
      
      // Try multiple sources for the avatar image
      if (profile.photos && profile.photos.length > 0) {
        avatarUrl = profile.photos[0]!.value;
      } else if (profile._json && profile._json.picture) {
        // Google's _json often contains 'picture' field
        avatarUrl = profile._json.picture;
      }

      // Remove size restrictions from Google Photos URLs to get high-res images
      if (avatarUrl) {
        // Google photos URLs often have size parameters like s96-c
        // Remove them to get the full-size image, or replace with a larger size
        avatarUrl = avatarUrl.replace(/=s\d+-c$/, '=s400-c'); // Use 400px instead of 96px
        // Alternative: remove size parameter entirely
        // avatarUrl = avatarUrl.replace(/=s\d+-c$/, '');
      }

      console.log("Extracted avatar URL:", avatarUrl);

      let user = await prisma.user.findUnique({ 
        where: { providerId: profile.id } 
      });

      if (!user) {
        const userData = {
          provider: "google" as const,
          providerId: profile.id,
          email: profile.emails?.[0]?.value || null,
          name: profile.displayName || null,
          avatarUrl: avatarUrl,
        };

        console.log("Creating new user with data:", userData);

        user = await prisma.user.create({
          data: userData,
        });
      } else {
        // Update existing user's avatar if it's missing or changed
        if (!user.avatarUrl && avatarUrl) {
          console.log("Updating existing user avatar:", avatarUrl);
          user = await prisma.user.update({
            where: { id: user.id },
            data: { avatarUrl: avatarUrl }
          });
        }
      }

      console.log("Final user object:", user);
      return done(null, user);
    } catch (err) {
      console.error("Error in Google strategy:", err);
      return done(err as Error, undefined);
    }
  }
);