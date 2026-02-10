import type { Request, Response, NextFunction } from "express";

/**
 * Ensure all RAG operations are scoped to the authenticated user
 */
export function enforceUserScope(req: Request, res: Response, next: NextFunction) {
  const authenticatedUserId = (req as any).user?.id;
  const requestUserId = req.body.userId || req.params.userId;
  
  if (!authenticatedUserId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (requestUserId && requestUserId !== authenticatedUserId) {
    console.warn(`User ${authenticatedUserId} attempted to access user ${requestUserId}'s data`);
    return res.status(403).json({ error: 'Forbidden: Cannot access other users\' data' });
  }
  
  // Inject user ID if not present
  if (!requestUserId) {
    req.body.userId = authenticatedUserId;
  }
  
  next();
}