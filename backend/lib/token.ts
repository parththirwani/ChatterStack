import jwt from "jsonwebtoken";
import crypto from "crypto";

const ACCESS_TTL = "15m";      // short-lived
const REFRESH_TTL_DAYS = 30;   // long-lived

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
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const), // set "none" if cross-site OAuth callback
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: "/",
    // Access token can be slightly shorter lived; refresh token aligns with DB expiry:
    maxAge: isRefresh ? 30*24*60*60*1000 : 15*60*1000,
  };
}
