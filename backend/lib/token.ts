import jwt from "jsonwebtoken";
import crypto from "crypto";

const ACCESS_TTL = "30d";      
const REFRESH_TTL_DAYS = 30;   

export function signAccessToken(payload: { id: string; provider: string }) {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: ACCESS_TTL });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, process.env.JWT_SECRET!) as { id: string; provider: string; iat: number; exp: number };
}

export function generateRefreshTokenString() {
  // 256-bit random token
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function refreshExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TTL_DAYS);
  return d;
}

export function cookieConfig(isRefresh=false) {
  const isProduction = process.env.NODE_ENV === "production";
  
  return {
    httpOnly: true,
    secure: isProduction, // Only secure in production (HTTPS)
    sameSite: isProduction ? ("none" as const) : ("lax" as const), // 'none' for cross-site in production, 'lax' for localhost
    domain: isProduction ? process.env.COOKIE_DOMAIN : undefined, // No domain for localhost
    path: "/",
    // Both tokens now have 30 days maxAge
    maxAge: 30*24*60*60*1000, // 30 days in milliseconds
  };
}