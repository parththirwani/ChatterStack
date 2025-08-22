import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "lib/token";


export function authenticate(req: Request, res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : undefined;

  const token = bearer || (req as any).cookies?.access_token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = verifyAccessToken(token);
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
