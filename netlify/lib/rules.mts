// Hard bid rules, enforced in code after the Reviewer agent answers. The AI recommends; these
// rules can only make the call MORE cautious, never less. Routing uses the final result. (#7)
import { HARD_LIMITS } from "./company-data.mts";
import { clampInt, oneOf, str, strList } from "./security.mts";

export type RuleCheck = { rule: string; result: "pass" | "fail" | "unknown"; note: string };
const DECISIONS = ["pursue", "decline", "needs_info"] as const;
const RESULTS = ["pass", "fail", "unknown"] as const;
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function checkHardRules(intake: any, estimate: any): RuleCheck[] {
  const miles = intake?.travel_miles;
  const total = Number(estimate?.totals?.total);
  const type = String(intake?.project_type ?? "other");
  const L = HARD_LIMITS;
  return [
    miles == null
      ? { rule: "Service area", result: "unknown", note: "Distance couldn't be looked up for this town." }
      : miles <= L.maxMiles
        ? { rule: "Service area", result: "pass", note: `${miles} miles from Hopkinton (limit ${L.maxMiles}).` }
        : { rule: "Service area", result: "fail", note: `${miles} miles from Hopkinton, over the ${L.maxMiles}-mile limit.` },
    !Number.isFinite(total)
      ? { rule: "Job size", result: "unknown", note: "No estimate total." }
      : total >= L.minJobValue && total <= L.maxJobValue
        ? { rule: "Job size", result: "pass", note: `${usd(total)} is inside ${usd(L.minJobValue)} to ${usd(L.maxJobValue)}.` }
        : { rule: "Job size", result: "fail", note: `${usd(total)} is outside ${usd(L.minJobValue)} to ${usd(L.maxJobValue)}.` },
    !Number.isFinite(total)
      ? { rule: "Bonding", result: "unknown", note: "No estimate total." }
      : total <= L.bondingCapacity
        ? { rule: "Bonding", result: "pass", note: `Under the ${usd(L.bondingCapacity)} bonding capacity.` }
        : { rule: "Bonding", result: "fail", note: `Over the ${usd(L.bondingCapacity)} bonding capacity.` },
    L.declinedProjectTypes.includes(type)
      ? { rule: "Scope fit", result: "fail", note: `${type.replace(/_/g, " ")} work is outside CEC's scope.` }
      : type === "other"
        ? { rule: "Scope fit", result: "unknown", note: "Project type unclear." }
        : { rule: "Scope fit", result: "pass", note: `${type.replace(/_/g, " ")} is a target scope.` },
  ];
}

// Validate the Reviewer's output, then apply the hard rules on top of it.
export function finalizeReview(raw: any, intake: any, estimate: any, security: { suspected: boolean; signals: string[] }) {
  const aiDecision = oneOf(raw?.decision, DECISIONS, "needs_info");
  const review = {
    ai_decision: aiDecision,
    decision: aiDecision as (typeof DECISIONS)[number],
    fit_score: clampInt(raw?.fit_score, 0, 100, 50),
    headline: str(raw?.headline, 400),
    rationale: str(raw?.rationale, 2500),
    criteria_checks: (Array.isArray(raw?.criteria_checks) ? raw.criteria_checks : []).slice(0, 20).map((c: any) => ({
      criterion: str(c?.criterion, 80), result: oneOf(c?.result, RESULTS, "unknown"), note: str(c?.note, 400),
    })),
    risks: strList(raw?.risks, 20, 400),
    questions_for_gc: strList(raw?.questions_for_gc, 15, 300),
    human_review_flags: strList(raw?.human_review_flags, 20, 400),
    gc_reply_draft: str(raw?.gc_reply_draft, 2500),
    rule_checks: checkHardRules(intake, estimate),
    override: null as null | string,
  };

  const failed = review.rule_checks.filter((r) => r.result === "fail");
  const unknown = review.rule_checks.filter((r) => r.result === "unknown");
  if (failed.length) {
    if (review.decision !== "decline") review.override = `Changed to Decline: failed ${failed.map((f) => f.rule.toLowerCase()).join(" and ")}.`;
    review.decision = "decline";
    review.fit_score = Math.min(review.fit_score, 25);
  } else if (review.decision === "pursue" && unknown.length) {
    review.override = `Changed to Needs info: ${unknown.map((u) => u.rule.toLowerCase()).join(" and ")} couldn't be confirmed.`;
    review.decision = "needs_info";
  }
  if (review.override) review.human_review_flags.unshift(`${review.override} The agent recommended ${aiDecision.replace("_", " ")}.`);

  if (security.suspected) {
    review.risks.unshift(`Possible prompt injection: the request ${security.signals.join("; ")}. It was treated as data, not instructions.`);
    review.human_review_flags.unshift("Read the original request yourself: it contains text aimed at the AI.");
  }
  if (["preferred", "good"].includes(intake?.gc_status)) {
    review.human_review_flags.push("The GC's identity comes from the sender's email domain, which can be faked. Confirm the sender before relying on their history.");
  }
  if (intake?.unverified_items?.length) {
    review.human_review_flags.push(`${intake.unverified_items.length} scope item(s) couldn't be verified against the request and were left out of the estimate. Check them under Scope.`);
  }
  return review;
}
