import type { Config } from "@netlify/functions";
import { saveBid, now, type Bid } from "../lib/store.mts";

// Trigger: a new bid request arrives (pasted email or forwarded intake form).
export default async (req: Request) => {
  const body = await req.json().catch(() => null);
  const from = String(body?.from ?? "").trim().slice(0, 200);
  const subject = String(body?.subject ?? "").trim().slice(0, 300);
  const text = String(body?.body ?? "").trim();
  if (!text || text.length < 40) return Response.json({ error: "Paste the full bid request (at least a few sentences)." }, { status: 400 });
  if (text.length > 20_000) return Response.json({ error: "Request is too long (20,000 character limit)." }, { status: 400 });

  const id = `bid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const bid: Bid = {
    id, createdAt: now(), updatedAt: now(), status: "received",
    source: { from: from || "Unknown sender", subject: subject || "(no subject)", body: text },
    trace: [], automation: [],
  };
  await saveBid(bid);

  // Kick off the agent pipeline in a background function (returns 202 immediately).
  const res = await fetch(new URL("/api/process", req.url), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
  });
  if (!res.ok && res.status !== 202) console.error("failed to start pipeline", res.status);
  return Response.json({ id }, { status: 201 });
};

export const config: Config = {
  path: "/api/submit",
  method: "POST",
  // Each submission spends AI credits, so cap it per visitor.
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
