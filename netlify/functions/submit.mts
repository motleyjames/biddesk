import type { Config } from "@netlify/functions";
import { saveBid, now, type Bid } from "../lib/store.mts";

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

// Trigger: a new bid invitation arrives, either from the GC bid portal (structured fields)
// or logged by an estimator from an email (pasted text).
export default async (req: Request) => {
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Send the bid details as JSON." }, { status: 400 });

  let channel: "portal" | "email" = body.channel === "portal" ? "portal" : "email";
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
      return Response.json({ error: "Company, project name, town and a scope description (a few sentences) are required." }, { status: 400 });
    }
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
    return Response.json({ error: "Paste the full bid email (at least a few sentences)." }, { status: 400 });
  }

  const id = `bid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const bid: Bid = {
    id, createdAt: now(), updatedAt: now(), status: "received",
    source: { from: from || "Unknown sender", subject: subject || "(no subject)", body: text, channel } as any,
    trace: [], automation: [],
  };
  await saveBid(bid);

  // Kick off the agent pipeline in a background function (returns 202 immediately).
  const res = await fetch(new URL("/api/process", req.url), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
  });
  if (!res.ok && res.status !== 202) console.error("failed to start pipeline", res.status);
  return Response.json({ id, reference: id.slice(4).toUpperCase() }, { status: 201 });
};

export const config: Config = {
  path: "/api/submit",
  method: "POST",
  // Each submission spends AI credits, so cap it per visitor.
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
