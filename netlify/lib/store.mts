import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

// Each kind of record has exactly one writer, so no two writers can overwrite each other: (#11)
//   bids/{id}        the pipeline (agents + routing automation)
//   decisions/{id}   the estimator's decision (decision endpoint)
//   flags/{id}       the hourly sweep's overdue flag (written once, only if new)
//   notifications/*  one key per notification, append-only
//   quota/*          one marker per submission, append-only (daily caps)
// Reads merge bid + decision + flag into one view.
const store = (name: string) => getStore({ name, consistency: "strong" });
const bids = () => store("bids");
const decisions = () => store("decisions");
const flags = () => store("flags");
const notes = () => store("notifications");
const quota = () => store("quota");

export type Status =
  | "received" | "intake" | "estimating" | "reviewing" | "analyzed"
  | "awaiting_review" | "approved" | "declined" | "info_requested" | "error";

export type TraceStep = { agent: string; kind: "tool_call" | "tool_result" | "thinking" | "final" | "error"; tool?: string; input?: unknown; output?: unknown; text?: string; at: string };
export type AutomationStep = { step: string; detail: string; at: string };
export type Decision = { action: "approved" | "declined" | "info_requested"; by: string; note: string; at: string };
export type Flag = { overdue: true; at: string; detail: string };

export type Bid = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  source: { from: string; subject: string; body: string; channel?: "portal" | "email" };
  security?: { suspected: boolean; signals: string[] };
  intake?: any;
  estimate?: any;
  review?: any;
  trace: TraceStep[];
  automation: AutomationStep[];
  routing?: { priority: "P1" | "P2" | "P3"; priorityReason: string; assignee: string; reviewDueAt: string; overdue?: boolean };
  decision?: Decision;
  error?: string;
  model?: string;
};

export const now = () => new Date().toISOString();
export const validId = (id: string) => /^bid-[a-z0-9]{6,14}-[a-z0-9]{4}$/.test(id);

/* ---------------- pipeline-owned bid record ---------------- */

export async function getBidRecord(id: string): Promise<Bid | null> {
  return (await bids().get(id, { type: "json" })) as Bid | null;
}

export async function saveBid(bid: Bid): Promise<Bid> {
  bid.updatedAt = now();
  await bids().setJSON(bid.id, bid);
  return bid;
}

// Only the pipeline calls this, and only one pipeline runs per bid.
export async function updateBid(id: string, fn: (b: Bid) => void): Promise<Bid> {
  const bid = await getBidRecord(id);
  if (!bid) throw new Error(`Bid ${id} not found`);
  fn(bid);
  return saveBid(bid);
}

/* ---------------- decision and flag records ---------------- */

export async function setDecision(id: string, d: Decision) {
  await decisions().setJSON(id, d);
}

// Written once. If two sweeps race, only the first write lands.
export async function setOverdueFlag(id: string, f: Flag): Promise<boolean> {
  const res = await flags().setJSON(id, f, { onlyIfNew: true });
  return res.modified;
}

/* ---------------- merged views ---------------- */

export function mergeView(b: Bid, d: Decision | null, f: Flag | null): Bid {
  const v: Bid = { ...b, automation: [...(b.automation ?? [])] };
  const decision = d ?? b.decision ?? null; // b.decision: records saved before this change
  if (f && !decision && v.routing) {
    v.routing = { ...v.routing, overdue: true };
    v.automation.push({ step: "Escalate overdue review", detail: f.detail, at: f.at });
  }
  if (decision) {
    v.decision = decision;
    v.status = decision.action;
    v.automation.push({ step: "Human decision recorded", detail: `${decision.by} marked this ${decision.action.replace("_", " ")}${b.review?.decision && mapAgent(b.review.decision) !== decision.action ? " (overrode the recommendation)" : ""}.`, at: decision.at });
  }
  return v;
}
const mapAgent = (d: string) => (d === "pursue" ? "approved" : d === "decline" ? "declined" : "info_requested");

export async function getBid(id: string): Promise<Bid | null> {
  const [b, d, f] = await Promise.all([
    getBidRecord(id),
    decisions().get(id, { type: "json" }) as Promise<Decision | null>,
    flags().get(id, { type: "json" }) as Promise<Flag | null>,
  ]);
  return b ? mergeView(b, d, f) : null;
}

/* ---------------- cheap listing (#16) ---------------- */
// list() returns every key with its etag in one call. We keep each record in a per-instance cache
// keyed by etag, so a poll only downloads records that actually changed, and the combined etag
// lets the browser get a 304 when nothing changed at all.

const caches = new Map<string, Map<string, { etag: string; value: any }>>();

async function readAll(name: string): Promise<{ values: Map<string, any>; tag: string }> {
  const s = store(name);
  const cache = caches.get(name) ?? new Map();
  caches.set(name, cache);
  const { blobs } = await s.list();
  const values = new Map<string, any>();
  await Promise.all(blobs.map(async ({ key, etag }) => {
    const hit = cache.get(key);
    if (hit && hit.etag === etag) { values.set(key, hit.value); return; }
    const value = await s.get(key, { type: "json" });
    if (value != null) { cache.set(key, { etag, value }); values.set(key, value); }
  }));
  for (const key of cache.keys()) if (!values.has(key)) cache.delete(key);
  const tag = blobs.map((b) => `${b.key}:${b.etag}`).sort().join("|");
  return { values, tag };
}

export async function listBidViews(): Promise<{ bids: Bid[]; etag: string }> {
  const [b, d, f] = await Promise.all([readAll("bids"), readAll("decisions"), readAll("flags")]);
  const list = [...b.values.values()].map((bid: Bid) => mergeView(bid, d.values.get(bid.id) ?? null, f.values.get(bid.id) ?? null));
  list.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const etag = `"${createHash("sha1").update(`${b.tag}#${d.tag}#${f.tag}`).digest("hex").slice(0, 20)}"`;
  return { bids: list, etag };
}

/* ---------------- notifications ---------------- */

export type Notification = { id: string; bidId: string; title: string; body: string; level: "info" | "warn" | "urgent"; at: string; read: boolean };

export async function notify(n: Omit<Notification, "id" | "at" | "read">) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await notes().setJSON(id, { ...n, id, at: now(), read: false });
}

export async function listNotifications(): Promise<Notification[]> {
  const { values } = await readAll("notifications");
  return ([...values.values()] as Notification[]).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
}

export async function markAllRead() {
  const list = await listNotifications();
  await Promise.all(list.filter((n) => !n.read).map((n) => notes().setJSON(n.id, { ...n, read: true })));
}

/* ---------------- submission quota (#3, #4) ---------------- */

const day = () => new Date().toISOString().slice(0, 10);

// Markers are keyed day/visitor/timestamp-bid; signed-in estimators use visitor "staff".
export async function countSubmissions(visitor: string) {
  const today = (await quota().list({ prefix: `${day()}/` })).blobs;
  const isStaff = (k: string) => k.startsWith(`${day()}/staff/`);
  const mine = today.filter((b) => b.key.startsWith(`${day()}/${visitor}/`));
  const hourAgo = Date.now() - 3600_000;
  return {
    publicToday: today.filter((b) => !isStaff(b.key)).length,
    staffToday: today.filter((b) => isStaff(b.key)).length,
    visitorToday: mine.length,
    visitorLastHour: mine.filter((b) => Number(b.key.split("/")[2]?.split("-")[0]) > hourAgo).length,
  };
}

export async function recordSubmission(visitor: string, bidId: string) {
  await quota().setJSON(`${day()}/${visitor}/${Date.now()}-${bidId}`, { at: now() }, { onlyIfNew: true });
}
