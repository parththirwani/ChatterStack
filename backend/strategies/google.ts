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
      console.log("=== Google Auth Debug ===");
      console.log("Full profile object:", JSON.stringify(profile, null, 2));
      console.log("Profile ID:", profile.id);
      console.log("Profile displayName:", profile.displayName);
      console.log("Profile emails:", profile.emails);
      console.log("Profile photos:", profile.photos);
      console.log("Profile _json:", (profile as any)._json);

      // Extract avatar
      let avatarUrl: string | null = null;

      console.log("Checking for avatar in photos...");
      if (profile.photos?.[0]?.value) {
        avatarUrl = profile.photos[0].value;
        console.log("✅ Avatar found in photos:", avatarUrl);
      } else {
        console.log("❌ No avatar in profile.photos");
      }

      console.log("Checking for avatar in _json...");
      if (!avatarUrl && (profile as any)._json?.picture) {
        avatarUrl = (profile as any)._json.picture;
        console.log("✅ Avatar found in _json.picture:", avatarUrl);
      } else if (!avatarUrl) {
        console.log("❌ No avatar in _json.picture");
      }

      // Try alternative locations for avatar
      if (!avatarUrl) {
        console.log("Checking alternative avatar locations...");
        const altSources = [
          (profile as any).picture,
          (profile as any).image,
          (profile as any)._json?.image,
          (profile as any)._json?.avatar_url,
        ];
        
        for (let i = 0; i < altSources.length; i++) {
          if (altSources[i]) {
            avatarUrl = altSources[i];
            console.log(`✅ Avatar found in alternative source ${i}:`, avatarUrl);
            break;
          }
        }
      }

      // Normalize Google avatar (remove size param or upscale)
      if (avatarUrl) {
        const originalUrl = avatarUrl;
        console.log("Original avatar URL:", originalUrl);
        
        avatarUrl = avatarUrl.replace(/=s\d+-c$/, "=s400-c");
        console.log("Normalized avatar URL:", avatarUrl);
        
        // Also try removing size restrictions entirely for Google photos
        if (originalUrl.includes('googleusercontent.com')) {
          const noSizeUrl = originalUrl.replace(/=s\d+-c$/, '').replace(/=s\d+$/, '');
          console.log("No-size avatar URL:", noSizeUrl);
          // You might want to test this URL too
        }
      } else {
        console.log("❌ No avatar URL found anywhere in profile");
      }

      let user = await prisma.user.findUnique({
        where: { providerId: profile.id },
      });

      if (!user) {
        console.log("Creating new Google user...");
        user = await prisma.user.create({
          data: {
            provider: "google",
            providerId: profile.id,
            email: profile.emails?.[0]?.value || null,
            name: profile.displayName || null,
            avatarUrl,
          },
        });
        console.log("✅ New user created with avatar:", user.avatarUrl);
      } else if (!user.avatarUrl && avatarUrl) {
        console.log("Updating existing user with avatar...");
        console.log("User current avatar:", user.avatarUrl);
        console.log("New avatar to set:", avatarUrl);
        
        user = await prisma.user.update({
          where: { id: user.id },
          data: { avatarUrl },
        });
        console.log("✅ User avatar updated to:", user.avatarUrl);
      } else {
        console.log("User already has avatar or no avatar to set");
        console.log("Current user avatar:", user.avatarUrl);
        console.log("Avatar from profile:", avatarUrl);
      }

      console.log("Final user data:", {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        provider: user.provider
      });
      console.log("=== End Google Auth Debug ===");

      return done(null, user);
    } catch (err) {
      console.error("❌ Google auth error:", err);
      return done(err as Error, undefined);
    }
  }
) as any; // Type assertion to bypass the compatibility issue