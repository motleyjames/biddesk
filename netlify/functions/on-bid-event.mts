import type { Config } from "@netlify/functions";
import { runIntakeAutomation } from "../lib/automation.mts";
import { updateBid, now } from "../lib/store.mts";

// Event-triggered automation: bid.analyzed -> score priority -> route -> schedule review -> notify.
export default async (req: Request) => {
  const evt = await req.json().catch(() => null);
  if (!evt || evt.type !== "bid.analyzed" || !evt.id) return;
  try {
    await runIntakeAutomation(evt.id);
  } catch (err: any) {
    console.error("automation failed", err);
    await updateBid(evt.id, (b) => b.automation.push({ step: "Automation error", detail: String(err?.message ?? err), at: now() }));
  }
};

export const config: Config = { background: true, path: "/api/events" };
