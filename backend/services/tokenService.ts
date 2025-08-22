import { PrismaClient } from "@prisma/client";
import {
  signAccessToken,
  generateRefreshTokenString,
  hashToken,
  refreshExpiryDate,
  cookieConfig,
} from "../lib/token";

const prisma = new PrismaClient();

export async function issueTokens(res: any, user: { id: string; provider: string }, meta: { ip?: string; ua?: string }) {
  const access = signAccessToken(user);
  const refreshRaw = generateRefreshTokenString();
  const refresh = {
    tokenHash: hashToken(refreshRaw),
    userId: user.id,
    expiresAt: refreshExpiryDate(),
    createdByIp: meta.ip,
    userAgent: meta.ua,
  };

  await prisma.refreshToken.create({ data: refresh });

  res.cookie("access_token", access, cookieConfig(false));
  res.cookie("refresh_token", refreshRaw, cookieConfig(true));
  res.json({ success: true, user, accessToken: access });
}
