import { listBidViews, setOverdueFlag, notify, now } from "./store.mts";

// Scheduled automation (hourly): find reviews past their deadline, flag them overdue, escalate.
// The sweep only writes its own flag record (once), so it can't overwrite a human decision. (#11)
export async function sweep() {
  const { bids } = await listBidViews();
  let escalated = 0;
  for (const bid of bids) {
    if (bid.status !== "awaiting_review" || bid.decision || !bid.routing || bid.routing.overdue) continue;
    if (new Date(bid.routing.reviewDueAt) > new Date()) continue;
    const added = await setOverdueFlag(bid.id, { overdue: true, at: now(), detail: "Review deadline passed; escalated to Senior Estimator." });
    if (!added) continue;
    await notify({ bidId: bid.id, title: `Overdue review: ${bid.intake?.project_name ?? bid.source.subject}`, body: `Was due ${bid.routing.reviewDueAt}. Escalated to Senior Estimator.`, level: "urgent" });
    escalated++;
  }
  return { checked: bids.length, escalated };
}
