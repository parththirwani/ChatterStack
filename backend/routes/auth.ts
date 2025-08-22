import { Router } from "express";
import passport from "passport";
import { z } from "zod";
import { issueTokens } from "../services/tokenService";
import { findUserById } from "../services/userService";

import { PrismaClient } from "@prisma/client";
import { googleStrategy } from "startergies/google";
import { githubStrategy } from "startergies/github";
import { cookieConfig, generateRefreshTokenString, hashToken, refreshExpiryDate, signAccessToken } from "lib/token";


const prisma = new PrismaClient();
const router = Router();

// Register strategies
passport.use(googleStrategy);
passport.use(githubStrategy);

// ---- Routes
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"], session: false }));
router.get("/github", passport.authenticate("github", { scope: ["user:email"], session: false }));

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/login" }),
  async (req: any, res) => {
    await issueTokens(res, { id: req.user.id, provider: req.user.provider }, { ip: req.ip, ua: req.get("user-agent") });
  }
);

router.get(
  "/github/callback",
  passport.authenticate("github", { session: false, failureRedirect: "/login" }),
  async (req: any, res) => {
    await issueTokens(res, { id: req.user.id, provider: req.user.provider }, { ip: req.ip, ua: req.get("user-agent") });
  }
);

// ---- Refresh
router.post("/refresh", async (req, res) => {
  const token = (req as any).cookies?.refresh_token;
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
});

// ---- Logout
router.post("/logout", async (req, res) => {
  const token = (req as any).cookies?.refresh_token;
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
});

// ---- Validate
router.post("/validate", async (req, res) => {
  const schema = z.object({ userId: z.string().cuid() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.format());

  const user = await findUserById(parsed.data.userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({ ok: true, user });
});

export default router;
