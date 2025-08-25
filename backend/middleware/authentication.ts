import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../lib/token";

export function authenticate(req: Request, res: Response, next: NextFunction) {
  // Try Bearer token first
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : undefined;

  // Fall back to cookie
  const cookieToken = (req as any).cookies?.access_token;
  
  const token = bearer || cookieToken;
  
  if (!token) {
    return res.status(401).json({ error: "Unauthorized - No token provided" });
  }

  try {
    const decoded = verifyAccessToken(token);
    (req as any).user = decoded;
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}