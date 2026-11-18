import type { Config, Context } from "@netlify/functions";
import { getBidRecord, updateBid, now, validId } from "../lib/store.mts";
import { runIntake, runEstimator, runReviewer } from "../lib/agents.mts";
import { isInternal, internalKey } from "../lib/auth.mts";
import { detectInjection } from "../lib/security.mts";

const STAGE: Record<string, string> = { intake: "reading the invite", estimating: "pricing the scope", reviewing: "checking the rules" };

// Background function (up to 15 min): runs the three agents in sequence.
// Only BidDesk's own submit function can start it: requests without the internal key are ignored. (#12)
export default async (req: Request, context: Context) => {
  if (!isInternal(req)) { console.warn("process: rejected call without internal key"); return; }
  const { id } = await req.json().catch(() => ({ id: null }));
  if (typeof id !== "string" || !validId(id)) return;
  const bid = await getBidRecord(id);
  if (!bid || bid.status !== "received") return; // idempotent guard against retries

  let stage = "intake";
  try {
    const security = detectInjection(`${bid.source.subject}\n${bid.source.body}`);
    await updateBid(id, (b) => { b.status = "intake"; b.security = security; });
    const intake = await runIntake(id, bid.source);

    stage = "estimating";
    await updateBid(id, (b) => { b.intake = intake.output; b.model = intake.model; b.status = "estimating"; });
    const estimate = await runEstimator(id, intake.output);

    stage = "reviewing";
    await updateBid(id, (b) => { b.estimate = estimate.output; b.status = "reviewing"; });
    const review = await runReviewer(id, intake.output, estimate.output, security);
    await updateBid(id, (b) => { b.review = review.output; b.status = "analyzed"; });

    // Emit the event that triggers the separate automation workflow.
    await fetch(new URL("/api/events", req.url), {
      method: "POST",
      headers: { "content-type": "application/json", "x-biddesk-internal": internalKey()! },
      body: JSON.stringify({ type: "bid.analyzed", id }),
    });
  } catch (err) {
    // Full details go to the function log only; the dashboard gets a plain message and a reference. (#14)
    const ref = context.requestId ?? Math.random().toString(36).slice(2, 10);
    console.error(`[${ref}] pipeline failed while ${STAGE[stage]}`, err);
    await updateBid(id, (b) => {
      b.status = "error";
      b.error = `Analysis stopped while ${STAGE[stage]}. Try again, or check the function log for reference ${ref}.`;
      b.trace.push({ agent: "System", kind: "error", text: b.error, at: now() });
    });
  }
};

export const config: Config = { background: true, path: "/api/process" };
