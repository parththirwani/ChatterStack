import { Router } from "express";
import passport from "passport";
import { z } from "zod";
import { issueTokens } from "../services/tokenService";
import { findUserById } from "../services/userService";
import { verifyAccessToken } from "../lib/token";

import { PrismaClient } from "@prisma/client";
import { googleStrategy } from "../strategies/google";
import { githubStrategy } from "../strategies/github";
import { cookieConfig, generateRefreshTokenString, hashToken, refreshExpiryDate, signAccessToken } from "../lib/token";

const prisma = new PrismaClient();
const router = Router();

// Frontend URL for redirects
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3001";

// Register strategies
passport.use(googleStrategy);
passport.use(githubStrategy);

// ---- OAuth Routes
router.get("/google", passport.authenticate("google", { 
  scope: ["profile", "email"], 
  session: false 
}));

router.get("/github", passport.authenticate("github", { 
  scope: ["user:email"], 
  session: false 
}));

// ---- OAuth Callbacks
router.get("/google/callback", 
  passport.authenticate("google", { 
    session: false, 
    failureRedirect: `${FRONTEND_URL}/chat?auth=error` 
  }),
  async (req: any, res) => {
    try {
      await issueTokens(res, { id: req.user.id, provider: req.user.provider }, { ip: req.ip, ua: req.get("user-agent") });
      // Redirect to frontend with success parameter
      res.redirect(`${FRONTEND_URL}/chat?auth=success`);
    } catch (error) {
      console.error("Error in Google callback:", error);
      res.redirect(`${FRONTEND_URL}/chat?auth=error`);
    }
  }
);

router.get("/github/callback",
  passport.authenticate("github", { 
    session: false, 
    failureRedirect: `${FRONTEND_URL}/chat?auth=error` 
  }),
  async (req: any, res) => {
    try {
      await issueTokens(res, { id: req.user.id, provider: req.user.provider }, { ip: req.ip, ua: req.get("user-agent") });
      // Redirect to frontend with success parameter
      res.redirect(`${FRONTEND_URL}/chat?auth=success`);
    } catch (error) {
      console.error("Error in GitHub callback:", error);
      res.redirect(`${FRONTEND_URL}/chat?auth=error`);
    }
  }
);

// ---- Token Management
router.post("/refresh", async (req, res) => {
  try {
    const token = req.cookies?.refresh_token;
    if (!token) return res.status(401).json({ error: "Missing refresh token" });

    const tokenHash = hashToken(token);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) return res.status(403).json({ error: "Invalid refresh token" });
    if (stored.revokedAt || stored.expiresAt < new Date()) return res.status(403).json({ error: "Expired or revoked" });

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) return res.status(403).json({ error: "User not found" });

    const newRaw = generateRefreshTokenString();
    const newHash = hashToken(newRaw);
    const newExpires = refreshExpiryDate();

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { tokenHash },
        data: { revokedAt: new Date(), replacedByToken: newRaw },
      }),
      prisma.refreshToken.create({
        data: {
          tokenHash: newHash,
          userId: user.id,
          expiresAt: newExpires,
          createdByIp: req.ip,
          userAgent: req.get("user-agent") || undefined,
        },
      }),
    ]);

    const access = signAccessToken({ id: user.id, provider: user.provider });

    res.cookie("access_token", access, cookieConfig(false));
    res.cookie("refresh_token", newRaw, cookieConfig(true));
    res.json({ success: true, accessToken: access });
  } catch (error) {
    console.error("Error in refresh:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Logout
router.post("/logout", async (req, res) => {
  try {
    const token = req.cookies?.refresh_token;
    if (token) {
      const tokenHash = hashToken(token);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    res.clearCookie("access_token", cookieConfig(false));
    res.clearCookie("refresh_token", cookieConfig(true));
    res.json({ success: true });
  } catch (error) {
    console.error("Error in logout:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Validate Token
router.post("/validate", async (req, res) => {
  try {
    const token = req.cookies?.access_token;
    if (!token) return res.status(401).json({ error: "No access token" });

    const decoded = verifyAccessToken(token);
    const user = await findUserById(decoded.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ ok: true, user });
  } catch (error) {
    console.error("Error in validate:", error);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
});

export default router;