// Estimator login. Access codes live in the BIDDESK_USERS environment variable
// ("Name=code;Name2=code2"), never in the repo. A session is a signed, HttpOnly cookie that
// names the person, so "who decided" comes from the login, not from the request. (#1, #2, #13)
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const COOKIE = "__Host-bd_session";
const SESSION_HOURS = 12;
const MIN_CODE_LENGTH = 12;

const env = (k: string) => (globalThis as any).Netlify?.env?.get(k) ?? process.env[k];
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const hmac = (key: string, data: string) => createHmac("sha256", key).update(data).digest();
const sha = (s: string) => createHash("sha256").update(s).digest();

export function sessionSecret(): string | null {
  const s = env("BIDDESK_SESSION_SECRET");
  return s && s.length >= 32 ? s : null;
}

// Users with codes shorter than MIN_CODE_LENGTH are ignored, so a weak code can't be set by mistake.
export function users(): { name: string; code: string }[] {
  return String(env("BIDDESK_USERS") ?? "")
    .split(";")
    .map((pair) => {
      const i = pair.indexOf("=");
      return i < 1 ? null : { name: pair.slice(0, i).trim().slice(0, 60), code: pair.slice(i + 1).trim() };
    })
    .filter((u): u is { name: string; code: string } => !!u && !!u.name && u.code.length >= MIN_CODE_LENGTH);
}

export const authConfigured = () => !!sessionSecret() && users().length > 0;

// Fingerprint of a user's code, stored in the token: changing someone's code logs them out.
const codePrint = (secret: string, code: string) => b64u(hmac(secret, `code:${code}`)).slice(0, 16);

export function findUserByCode(code: string) {
  const given = sha(String(code ?? ""));
  let match: { name: string; code: string } | null = null;
  for (const u of users()) if (timingSafeEqual(given, sha(u.code))) match = u; // check all, no early exit
  return match;
}

export function makeSessionCookie(user: { name: string; code: string }) {
  const secret = sessionSecret()!;
  const payload = b64u(JSON.stringify({ n: user.name, k: codePrint(secret, user.code), exp: Date.now() + SESSION_HOURS * 3600_000 }));
  const token = `${payload}.${b64u(hmac(secret, payload))}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function readSession(req: Request): { name: string } | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const raw = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!payload || !sig) return null;
  const expected = hmac(secret, payload);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    const user = users().find((u) => u.name === data.n && codePrint(secret, u.code) === data.k);
    return user ? { name: user.name } : null;
  } catch {
    return null;
  }
}

// State-changing requests must come from this site's own pages. SameSite=Strict already blocks
// cross-site cookies; this is a second check. (#2)
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

// Key for the internal pipeline routes, derived from the session secret so there's one secret to set. (#12)
export function internalKey(): string | null {
  const s = sessionSecret();
  return s ? b64u(hmac(s, "biddesk-internal-v1")) : null;
}
export function isInternal(req: Request) {
  const key = internalKey();
  const got = req.headers.get("x-biddesk-internal") ?? "";
  if (!key || got.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(key));
}

// Hash of a visitor's IP for per-visitor limits; raw IPs are never stored.
export function visitorId(ip: string) {
  return b64u(hmac(sessionSecret() ?? "no-secret", `ip:${ip}`)).slice(0, 22);
}
