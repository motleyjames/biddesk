import type { Config } from "@netlify/functions";
import { getBid, updateBid, now } from "../lib/store.mts";
import { runIntake, runEstimator, runReviewer } from "../lib/agents.mts";

// Background function (up to 15 min): runs the three agents in sequence,
// writing each result to the bid so the dashboard can show progress live.
export default async (req: Request) => {
  const { id } = await req.json().catch(() => ({ id: null }));
  if (!id) return;
  const bid = await getBid(id);
  if (!bid || bid.status !== "received") return; // idempotent guard against retries

  try {
    await updateBid(id, (b) => { b.status = "intake"; });
    const intake = await runIntake(id, bid.source);
    await updateBid(id, (b) => { b.intake = intake.output; b.model = intake.model; b.status = "estimating"; });

    const estimate = await runEstimator(id, intake.output);
    await updateBid(id, (b) => { b.estimate = estimate.output; b.status = "reviewing"; });

    const review = await runReviewer(id, intake.output, estimate.output);
    await updateBid(id, (b) => { b.review = review.output; b.status = "analyzed"; });

    // Emit the event that triggers the separate automation workflow.
    await fetch(new URL("/api/events", req.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "bid.analyzed", id }),
    });
  } catch (err: any) {
    console.error("pipeline failed", err);
    await updateBid(id, (b) => {
      b.status = "error";
      b.error = String(err?.message ?? err).slice(0, 500);
      b.trace.push({ agent: "System", kind: "error", text: b.error, at: now() });
    });
  }
};

export const config: Config = { background: true, path: "/api/process" };
