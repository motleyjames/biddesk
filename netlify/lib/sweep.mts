import { listBids, saveBid, notify, now } from "./store.mts";

// Scheduled automation (hourly): find reviews past their deadline -> mark overdue -> escalate.
export async function sweep() {
  const bids = await listBids();
  let escalated = 0;
  for (const bid of bids) {
    if (bid.status !== "awaiting_review" || !bid.routing || bid.routing.overdue) continue;
    if (new Date(bid.routing.reviewDueAt) > new Date()) continue;
    bid.routing.overdue = true;
    bid.automation.push({ step: "Escalate overdue review", detail: `Review deadline passed; escalated to Senior Estimator.`, at: now() });
    await saveBid(bid);
    await notify({ bidId: bid.id, title: `Overdue review: ${bid.intake?.project_name ?? bid.source.subject}`, body: `Was due ${bid.routing.reviewDueAt}. Escalated to Senior Estimator.`, level: "urgent" });
    escalated++;
  }
  return { checked: bids.length, escalated };
}

