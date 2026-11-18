import type { Config } from "@netlify/functions";
import { authConfigured, findUserByCode, makeSessionCookie, clearCookie, readSession, sameOrigin } from "../lib/auth.mts";
import { json, fail } from "../lib/http.mts";

// POST /api/login {code}  ·  POST /api/logout  ·  GET /api/session
export default async (req: Request) => {
  const path = new URL(req.url).pathname.replace(/\/$/, "");

  if (path === "/api/session" && req.method === "GET") {
    const user = readSession(req);
    return user ? json({ user }) : json({ user: null, configured: authConfigured() }, 401);
  }

  if (req.method !== "POST" || !sameOrigin(req)) return fail(403, "Not allowed.");

  if (path === "/api/logout") return json({ ok: true }, 200, { "set-cookie": clearCookie() });

  if (path === "/api/login") {
    if (!authConfigured()) return fail(503, "Sign-in isn't set up yet. An admin needs to add BIDDESK_USERS and BIDDESK_SESSION_SECRET in Netlify.");
    const body = await req.json().catch(() => ({}));
    const user = findUserByCode(String(body?.code ?? "").slice(0, 200));
    if (!user) {
      await new Promise((r) => setTimeout(r, 400)); // slow down guessing (Netlify also rate-limits this route)
      return fail(401, "That access code didn't work.");
    }
    return json({ user: { name: user.name } }, 200, { "set-cookie": makeSessionCookie(user) });
  }

  return fail(404, "Not found.");
};

export const config: Config = {
  path: ["/api/login", "/api/logout", "/api/session"],
  // 10 attempts per minute per visitor IP. This is the site's second (and last) free-plan rule.
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
