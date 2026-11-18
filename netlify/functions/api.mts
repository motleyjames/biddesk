import type { Config, Context } from "@netlify/functions";
import { getBid, listBidViews, setDecision, listNotifications, markAllRead, now, validId, type Bid } from "../lib/store.mts";
import { sweep } from "../lib/sweep.mts";
import { readSession, sameOrigin } from "../lib/auth.mts";
import { json, fail, serverError, refId } from "../lib/http.mts";

const ACTIONS = ["approved", "declined", "info_requested"] as const;

const summary = (b: Bid) => ({
  id: b.id, createdAt: b.createdAt, status: b.status, subject: b.source.subject, from: b.source.from,
  project: b.intake?.project_name ?? null, gc: b.intake?.gc_name ?? null, town: b.intake?.location_town ?? null,
  decision: b.review?.decision ?? null, fitScore: b.review?.fit_score ?? null, total: b.estimate?.totals?.total ?? null,
  priority: b.routing?.priority ?? null, overdue: b.routing?.overdue ?? false, humanDecision: b.decision?.action ?? null,
  bidDue: b.intake?.bid_due_date ?? null, reviewDueAt: b.routing?.reviewDueAt ?? null, assignee: b.routing?.assignee ?? null,
  channel: b.source.channel ?? "email", injection: !!b.security?.suspected,
});

// Every route here needs a signed-in estimator. (#1, #2, #13)
export default async (req: Request, context: Context) => {
  const ref = context.requestId ?? refId();
  const path = new URL(req.url).pathname.replace(/\/$/, "");
  try {
    const user = readSession(req);
    if (!user) return fail(401, "Sign in to continue.");
    if (req.method !== "GET" && !sameOrigin(req)) return fail(403, "Not allowed.");

    if (req.method === "GET" && path === "/api/bids") {
      const { bids, etag } = await listBidViews();
      // Cheap polling: if nothing changed, the browser gets a 304 with no body. (#16)
      if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "private, no-cache" } });
      return json(bids.map(summary), 200, { etag, "cache-control": "private, no-cache" });
    }

    const m = path.match(/^\/api\/bids\/([^/]+)(\/decision)?$/);
    if (m && !validId(m[1])) return fail(404, "Not found.");

    if (m && req.method === "GET" && !m[2]) {
      const bid = await getBid(m[1]);
      return bid ? json(bid) : fail(404, "Not found.");
    }

    if (m && req.method === "POST" && m[2]) {
      const body = await req.json().catch(() => ({}));
      const action = ACTIONS.find((a) => a === body?.action);
      if (!action) return fail(400, "Choose approve, ask questions, or decline.");
      const bid = await getBid(m[1]);
      if (!bid) return fail(404, "Not found.");
      if (!["awaiting_review", ...ACTIONS].includes(bid.status)) return fail(409, "This bid isn't ready for review yet.");
      // "by" is the signed-in person, never a value from the request.
      await setDecision(m[1], { action, by: user.name, note: String(body?.note ?? "").slice(0, 1000), at: now() });
      return json(await getBid(m[1]));
    }

    if (path === "/api/notifications") {
      if (req.method === "POST") { await markAllRead(); return json({ ok: true }); }
      return json(await listNotifications());
    }

    if (path === "/api/sweep" && req.method === "POST") return json(await sweep());

    return fail(404, "Not found.");
  } catch (err) {
    return serverError(err, ref);
  }
};

export const config: Config = {
  path: ["/api/bids", "/api/bids/*", "/api/notifications", "/api/sweep"],
};
