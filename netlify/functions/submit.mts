import type { Config, Context } from "@netlify/functions";
import { saveBid, now, countSubmissions, recordSubmission, type Bid } from "../lib/store.mts";
import { readSession, sameOrigin, internalKey, visitorId } from "../lib/auth.mts";
import { json, fail, serverError, refId } from "../lib/http.mts";

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const env = (k: string, d: number) => { const n = Number(Netlify.env.get(k)); return Number.isFinite(n) && n > 0 ? n : d; };

// Spending caps. Each submission runs at most 22 model calls (6 + 10 + 6 agent turns). (#3, #4)
const LIMITS = () => ({
  publicPerDay: env("BIDDESK_PUBLIC_DAILY_LIMIT", 25),  // all portal visitors combined
  visitorPerHour: env("BIDDESK_VISITOR_HOURLY_LIMIT", 3),
  visitorPerDay: env("BIDDESK_VISITOR_DAILY_LIMIT", 5),
  staffPerDay: env("BIDDESK_STAFF_DAILY_LIMIT", 60),    // signed-in estimators combined
});

// Trigger: a new bid invitation arrives, either from the GC bid portal (public, capped)
// or logged by a signed-in estimator from an email.
export default async (req: Request, context: Context) => {
  const ref = refId();
  try {
    if (!sameOrigin(req)) return fail(403, "Submit bids from the BidDesk site.");
    const key = internalKey();
    if (!key) return fail(503, "BidDesk isn't configured yet. An admin needs to set its environment variables.");
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail(400, "Send the bid details as JSON.");

    const user = readSession(req);
    const channel: "portal" | "email" = body.channel === "portal" ? "portal" : "email";
    if (channel === "email" && !user) return fail(401, "Sign in to log bid emails.");

    // Bots fill hidden fields. Pretend it worked and do nothing.
    if (clean(body.website, 200)) return json({ id: null, reference: refId().toUpperCase() }, 201);

    const visitor = user ? "staff" : visitorId(context.ip ?? "unknown");
    const c = await countSubmissions(visitor);
    const L = LIMITS();
    if (user && c.staffToday >= L.staffPerDay) return fail(429, `Today's limit of ${L.staffPerDay} analyses is used up. It resets at midnight UTC.`);
    if (!user) {
      if (c.publicToday >= L.publicPerDay) return fail(429, "The bid portal has reached today's limit. Please try again tomorrow or email CEC directly.");
      if (c.visitorLastHour >= L.visitorPerHour || c.visitorToday >= L.visitorPerDay) return fail(429, "You've sent several bids recently. Please try again later.");
    }

    let from = clean(body.from, 200);
    let subject = clean(body.subject, 300);
    let text = clean(body.body, 20_000);

    if (channel === "portal") {
      const f = {
        company: clean(body.company, 120), contact: clean(body.contact, 120), email: clean(body.email, 160),
        project: clean(body.project, 200), address: clean(body.address, 200), town: clean(body.town, 80),
        state: clean(body.state, 4), due: clean(body.due, 20), start: clean(body.start, 20),
        scope: clean(body.scope, 15_000), notes: clean(body.notes, 2_000),
      };
      if (!f.company || !f.project || !f.town || f.scope.length < 30) {
        return fail(400, "Company, project name, town and a scope description (a few sentences) are required.");
      }
      if (f.email && !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(f.email)) return fail(400, "Enter a valid email address.");
      from = `${f.contact || f.company}${f.email ? ` <${f.email}>` : ""}`;
      subject = `Bid portal: ${f.project}`;
      text = [
        `Bid invitation submitted through the CEC bid portal.`,
        `General contractor: ${f.company}`,
        f.contact ? `Contact: ${f.contact}${f.email ? ` (${f.email})` : ""}` : "",
        `Project: ${f.project}`,
        `Location: ${[f.address, f.town, f.state].filter(Boolean).join(", ")}`,
        f.due ? `Bids due: ${f.due}` : "Bids due: not stated",
        f.start ? `Anticipated start: ${f.start}` : "",
        ``,
        `Electrical scope:`,
        f.scope,
        f.notes ? `\nNotes: ${f.notes}` : "",
      ].filter((l) => l !== "").join("\n");
    } else if (text.length < 40) {
      return fail(400, "Paste the full bid email (at least a few sentences).");
    }

    const id = `bid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const bid: Bid = {
      id, createdAt: now(), updatedAt: now(), status: "received",
      source: { from: from || "Unknown sender", subject: subject || "(no subject)", body: text, channel },
      trace: [], automation: [],
    };
    await recordSubmission(visitor, id);
    await saveBid(bid);

    // Kick off the agent pipeline in a background function (returns 202 immediately).
    const res = await fetch(new URL("/api/process", req.url), {
      method: "POST", headers: { "content-type": "application/json", "x-biddesk-internal": key }, body: JSON.stringify({ id }),
    });
    if (!res.ok && res.status !== 202) console.error(`[${ref}] failed to start pipeline`, res.status);
    return json({ id, reference: id.slice(4).toUpperCase() }, 201);
  } catch (err) {
    return serverError(err, ref);
  }
};

export const config: Config = {
  path: "/api/submit",
  method: "POST",
  // Netlify's own limit: per visitor IP, per minute. The daily caps above are enforced in code
  // because the free plan has no site-wide limit and only two code-based rules.
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
