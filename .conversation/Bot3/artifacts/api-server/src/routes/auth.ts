import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateAuthSessionBody,
  DeleteAuthSessionResponse,
  GetAuthSessionResponse,
} from "@workspace/api-zod";
import {
  accessCookieOptions,
  hasConfiguredAccessCode,
  isAccessSessionValid,
  issueAccessSession,
} from "../middlewares/access";

const router: IRouter = Router();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attemptsByIp = new Map<string, { count: number; expiresAt: number }>();

function getClientKey(ip: string | undefined): string {
  return ip || "unknown";
}

function hasTooManyAttempts(ip: string): boolean {
  const current = attemptsByIp.get(ip);
  if (!current || current.expiresAt <= Date.now()) {
    attemptsByIp.delete(ip);
    return false;
  }
  return current.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const current = attemptsByIp.get(ip);
  if (!current || current.expiresAt <= Date.now()) {
    attemptsByIp.set(ip, { count: 1, expiresAt: Date.now() + ATTEMPT_WINDOW_MS });
    return;
  }
  current.count += 1;
}

function matchesAccessCode(candidate: string, expected: string): boolean {
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

router.get("/auth/session", (req, res): void => {
  res.json(GetAuthSessionResponse.parse({ authenticated: isAccessSessionValid(req) }));
});

router.post("/auth/session", async (req, res): Promise<void> => {
  const parsed = CreateAuthSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the access code to continue." });
    return;
  }

  if (!hasConfiguredAccessCode()) {
    req.log.error("Workspace access code or session signing secret is unavailable.");
    res.status(503).json({ error: "Workspace access is not configured yet." });
    return;
  }

  const clientKey = getClientKey(req.ip);
  if (hasTooManyAttempts(clientKey)) {
    res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    return;
  }

  const expected = process.env.WHATSAPP_ACCESS_CODE!;
  if (!matchesAccessCode(parsed.data.code, expected)) {
    recordFailedAttempt(clientKey);
    res.status(401).json({ error: "That access code was not accepted." });
    return;
  }

  attemptsByIp.delete(clientKey);
  const session = issueAccessSession();
  res.cookie(session.cookieName, session.cookieValue, {
    ...accessCookieOptions,
    maxAge: session.maxAge,
  });
  res.json(GetAuthSessionResponse.parse({ authenticated: true }));
});

router.delete("/auth/session", (_req, res): void => {
  res.clearCookie("creator_studio_access", accessCookieOptions);
  res.status(204).send(DeleteAuthSessionResponse.parse(undefined));
});

export default router;