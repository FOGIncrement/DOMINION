import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const COOKIE_NAME = "dominion_session";

export interface AuthTokenPayload {
  playerId: string;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

// Per-request, not a blanket env flag — the same server process answers
// both the plain-http bare-IP:4000 path (still what the desktop launcher
// defaults to) and the https domain path (fronted by nginx), so whether
// this particular request is secure has to be judged per-request. Requires
// `app.set("trust proxy", 1)` (see index.ts) so req.secure reflects nginx's
// X-Forwarded-Proto instead of always reading as http.
export function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME);
}

export interface AuthedRequest extends Request {
  playerId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    req.playerId = payload.playerId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}
