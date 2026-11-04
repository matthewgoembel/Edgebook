import crypto from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';

const PASSWORD = process.env.EDGEBOOK_PASSWORD ?? '';
const COOKIE = 'edgebook_session';
const SESSION_DAYS = 180;
const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

/** With no password set the app is local-only; index.ts refuses to start on a public address. */
export const authEnabled = PASSWORD.length > 0;

// Derived from the password, so changing the password signs out every device.
const signingKey = crypto.createHash('sha256').update(`edgebook-session:${PASSWORD}`).digest();
const sign = (value: string) => crypto.createHmac('sha256', signingKey).update(value).digest('base64url');

function safeEqual(a: string, b: string) {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

function readCookie(req: Request) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

function isSignedIn(req: Request) {
  if (!authEnabled) return true;
  const [expires, signature] = (readCookie(req) ?? '').split('.');
  if (!expires || !signature) return false;
  return safeEqual(signature, sign(expires)) && Number(expires) > Date.now();
}

const cookieOptions = (req: Request) => ({ httpOnly: true, sameSite: 'lax' as const, secure: req.secure, path: '/' });

const failures = new Map<string, { count: number; until: number }>();

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isSignedIn(req)) return next();
  res.status(401).json({ error: 'Please sign in.' });
}

export function authRoutes(app: Express) {
  app.get('/api/session', (req, res) => {
    res.json({ required: authEnabled, authenticated: isSignedIn(req) });
  });

  app.post('/api/login', (req, res) => {
    if (!authEnabled) return void res.json({ ok: true });
    const ip = req.ip ?? 'unknown';
    const record = failures.get(ip);
    if (record && record.count >= MAX_FAILURES && record.until > Date.now()) {
      return void res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }
    if (!safeEqual(String(req.body?.password ?? ''), PASSWORD)) {
      const expired = !record || record.until <= Date.now();
      failures.set(ip, { count: (expired ? 0 : record.count) + 1, until: Date.now() + LOCKOUT_MS });
      return void res.status(401).json({ error: 'Wrong password.' });
    }
    failures.delete(ip);
    const maxAge = SESSION_DAYS * 86400000;
    const expires = String(Date.now() + maxAge);
    res.cookie(COOKIE, `${expires}.${sign(expires)}`, { ...cookieOptions(req), maxAge });
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE, cookieOptions(req));
    res.json({ ok: true });
  });
}
