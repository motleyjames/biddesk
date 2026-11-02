import { getBid, saveBid, notify, now, type Bid } from "./store.mts";

// Deterministic workflow, separate from the agents. Triggered by the "bid.analyzed" event.
// No LLM calls here: routing and deadlines must be predictable and auditable.

const HOUR = 3600_000;

function addBusinessHours(from: Date, hours: number): Date {
  // Simple model: business time = Mon-Fri, all hours. Weekend time is skipped.
  const d = new Date(from);
  let remaining = hours;
  while (remaining > 0) {
    d.setTime(d.getTime() + HOUR);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) remaining--;
  }
  return d;
}

function businessDaysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const end = new Date(`${date}T12:00:00Z`);
  if (isNaN(end.getTime())) return null;
  const d = new Date(); d.setUTCHours(12, 0, 0, 0);
  let n = 0;
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

export async function runIntakeAutomation(bidId: string): Promise<Bid | null> {
  const bid = await getBid(bidId);
  if (!bid || bid.status !== "analyzed") return bid; // idempotent: only runs once per analysis
  const log = (step: string, detail: string) => bid.automation.push({ step, detail, at: now() });

  const decision = bid.review?.decision as "pursue" | "decline" | "needs_info";
  const total = Number(bid.estimate?.totals?.total ?? 0);
  const daysLeft = businessDaysUntil(bid.intake?.bid_due_date);

  // Step 1: score priority
  let priority: "P1" | "P2" | "P3" = "P3";
  let reason = "Recommended decline: low urgency, confirm and send the no-bid.";
  if (decision === "pursue") {
    if ((daysLeft !== null && daysLeft <= 7) || total >= 250_000) { priority = "P1"; reason = `Pursue${daysLeft !== null ? `, bid due in ${daysLeft} business days` : ""}${total >= 250_000 ? `, est. $${Math.round(total).toLocaleString()}` : ""}.`; }
    else { priority = "P2"; reason = "Pursue with a comfortable bid window."; }
  } else if (decision === "needs_info") {
    priority = daysLeft !== null && daysLeft <= 5 ? "P1" : "P2";
    reason = `Questions must go to the GC${daysLeft !== null ? ` (bid due in ${daysLeft} business days)` : ""}.`;
  }
  log("1. Score priority", `${priority}: ${reason}`);

  // Step 2: route to the right reviewer
  const assignee = total >= 500_000 || priority === "P1" ? "Senior Estimator" : "Estimating Team";
  log("2. Route to queue", `Assigned to ${assignee} (rule: P1 or estimate of $500k or more goes to Senior Estimator).`);

  // Step 3: schedule the human review deadline
  const slaHours = priority === "P1" ? 4 : priority === "P2" ? 24 : 48;
  let due = addBusinessHours(new Date(), slaHours);
  if (bid.intake?.bid_due_date) {
    const latest = new Date(`${bid.intake.bid_due_date}T12:00:00Z`);
    latest.setUTCDate(latest.getUTCDate() - 1);
    if (latest > new Date() && latest < due) due = latest;
  }
  log("3. Schedule review", `Human review due ${due.toISOString()} (${slaHours} business-hour SLA for ${priority}${bid.intake?.bid_due_date ? `, capped one day before the ${bid.intake.bid_due_date} bid date` : ""}).`);

  // Step 4: notify the owner
  const label = decision === "pursue" ? "Pursue" : decision === "decline" ? "Decline" : "Needs info";
  await notify({
    bidId,
    title: `${priority} · ${label}: ${bid.intake?.project_name ?? bid.source.subject}`,
    body: `${assignee}: review by ${due.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET. ${bid.review?.headline ?? ""}`,
    level: priority === "P1" ? "urgent" : "info",
  });
  log("4. Notify owner", `Notification sent to ${assignee}.`);

  bid.routing = { priority, priorityReason: reason, assignee, reviewDueAt: due.toISOString() };
  bid.status = "awaiting_review";
  log("5. Enter review queue", "Status set to awaiting_review. Nothing is sent to the GC until a human approves.");
  return saveBid(bid);
}
