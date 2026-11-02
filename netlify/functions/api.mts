import type { Config, Context } from "@netlify/functions";
import { getBid, listBids, updateBid, listNotifications, markAllRead, now } from "../lib/store.mts";
import { sweep } from "../lib/sweep.mts";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "");

  try {
    if (req.method === "GET" && path === "/api/bids") {
      const bids = await listBids();
      return json(bids.map((b) => ({
        id: b.id, createdAt: b.createdAt, status: b.status, subject: b.source.subject, from: b.source.from,
        project: b.intake?.project_name ?? null, gc: b.intake?.gc_name ?? null, town: b.intake?.location_town ?? null,
        decision: b.review?.decision ?? null, fitScore: b.review?.fit_score ?? null, total: b.estimate?.totals?.total ?? null,
        priority: b.routing?.priority ?? null, overdue: b.routing?.overdue ?? false, humanDecision: b.decision?.action ?? null,
        bidDue: b.intake?.bid_due_date ?? null, reviewDueAt: b.routing?.reviewDueAt ?? null, assignee: b.routing?.assignee ?? null,
        channel: (b.source as any).channel ?? "email",
      })));
    }

    const m = path.match(/^\/api\/bids\/([\w-]+)(\/decision)?$/);
    if (m && req.method === "GET" && !m[2]) {
      const bid = await getBid(m[1]);
      return bid ? json(bid) : json({ error: "Not found" }, 404);
    }

    if (m && req.method === "POST" && m[2]) {
      const body = await req.json().catch(() => ({}));
      const action = body.action as "approved" | "declined" | "info_requested";
      if (!["approved", "declined", "info_requested"].includes(action)) return json({ error: "Invalid action" }, 400);
      const bid = await getBid(m[1]);
      if (!bid) return json({ error: "Not found" }, 404);
      if (!["awaiting_review", "approved", "declined", "info_requested"].includes(bid.status)) return json({ error: "Bid is not ready for review yet" }, 409);
      const updated = await updateBid(m[1], (b) => {
        b.decision = { action, by: String(body.by || "Estimator").slice(0, 60), note: String(body.note || "").slice(0, 1000), at: now() };
        b.status = action;
        b.automation.push({ step: "Human decision recorded", detail: `${b.decision.by} marked this ${action.replace("_", " ")}${b.review?.decision && mapAgent(b.review.decision) !== action ? " (overrode the agent recommendation)" : ""}.`, at: now() });
      });
      return json(updated);
    }

    if (path === "/api/notifications") {
      if (req.method === "POST") { await markAllRead(); return json({ ok: true }); }
      return json(await listNotifications());
    }

    if (path === "/api/sweep" && req.method === "POST") {
      return json(await sweep());
    }

    return json({ error: "Not found" }, 404);
  } catch (err: any) {
    console.error(err);
    return json({ error: String(err?.message ?? err) }, 500);
  }
};

function mapAgent(d: string) {
  return d === "pursue" ? "approved" : d === "decline" ? "declined" : "info_requested";
}

export const config: Config = {
  path: ["/api/bids", "/api/bids/*", "/api/notifications", "/api/sweep"],
};
