import type { Config } from "@netlify/functions";
import { runIntakeAutomation } from "../lib/automation.mts";
import { updateBid, now, validId } from "../lib/store.mts";
import { isInternal } from "../lib/auth.mts";

// Event-triggered automation: bid.analyzed -> score priority -> route -> schedule review -> notify.
// Only the pipeline can send this event: calls without the internal key are ignored. (#12)
export default async (req: Request) => {
  if (!isInternal(req)) { console.warn("events: rejected call without internal key"); return; }
  const evt = await req.json().catch(() => null);
  if (!evt || evt.type !== "bid.analyzed" || typeof evt.id !== "string" || !validId(evt.id)) return;
  try {
    await runIntakeAutomation(evt.id);
  } catch (err) {
    console.error("automation failed", err);
    await updateBid(evt.id, (b) => b.automation.push({ step: "Automation error", detail: "Routing failed. Check the function log.", at: now() }));
  }
};

export const config: Config = { background: true, path: "/api/events" };
