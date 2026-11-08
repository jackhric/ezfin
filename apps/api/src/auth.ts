import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db, User } from "./db.ts";

/**
 * Accounts and sessions with nothing but Node's standard library.
 *
 * - Passwords: scrypt (N=2^15, r=8, p=1) with a 16-byte random salt, stored as
 *   `scrypt$<salt>$<hash>` so the parameters can change later without breaking logins.
 * - Sessions: 32 random bytes in an httpOnly, SameSite=Strict cookie. Only the
 *   SHA-256 of the token is stored, so a copied database cannot be used to log in.
 * - Login failures are rate limited in memory. The API only listens on loopback,
 *   so this guards against a runaway script, not the internet.
 */
const scrypt = (password: string, salt: Buffer, keylen: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
const SESSION_COOKIE = "ezfin_session";
const SESSION_DAYS = 30;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, SCRYPT.keylen);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateCredentials(input: {
  username?: unknown;
  email?: unknown;
  password?: unknown;
}): { ok: true; username: string; email: string; password: string } | { ok: false; error: string } {
  const username = String(input.username ?? "").trim();
  const email = String(input.email ?? "").trim();
  const password = String(input.password ?? "");
  if (!/^[a-z0-9_.-]{3,32}$/i.test(username))
    return {
      ok: false,
      error: "Username must be 3 to 32 characters: letters, numbers, dot, dash or underscore.",
    };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return { ok: false, error: "Enter a valid email address." };
  if (password.length < 10 || password.length > 256)
    return { ok: false, error: "Password must be at least 10 characters." };
  return { ok: true, username, email, password };
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function startSession(c: Context, db: Db, userId: string): void {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.createSession(userId, hashToken(token), expires.toISOString());
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    expires,
    // Not `secure`: the app is served over plain http on loopback. SameSite=Strict plus the
    // loopback-only bind is what keeps the cookie from going anywhere else.
  });
}

export function endSession(c: Context, db: Db): void {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) db.deleteSession(hashToken(token));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function currentUser(c: Context, db: Db): User | undefined {
  const token = getCookie(c, SESSION_COOKIE);
  return token ? db.getSessionUser(hashToken(token)) : undefined;
}

/** Everything under /api except /api/auth/* needs a session. */
export function requireUser(db: Db): MiddlewareHandler<{ Variables: { user: User } }> {
  return async (c, next) => {
    const user = currentUser(c, db);
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    c.set("user", user);
    await next();
  };
}

/** Tiny fixed-window limiter: after 10 failures in 15 minutes, logins wait. */
export class LoginLimiter {
  private failures: number[] = [];
  blocked(): boolean {
    const cutoff = Date.now() - 15 * 60_000;
    this.failures = this.failures.filter((t) => t > cutoff);
    return this.failures.length >= 10;
  }
  fail(): void {
    this.failures.push(Date.now());
  }
  reset(): void {
    this.failures = [];
  }
}
