import { getStore } from "@netlify/blobs";

// Strong consistency so the dashboard sees each agent step as soon as it is written.
const bids = () => getStore({ name: "bids", consistency: "strong" });
const notes = () => getStore({ name: "notifications", consistency: "strong" });

export type Status =
  | "received" | "intake" | "estimating" | "reviewing" | "analyzed"
  | "awaiting_review" | "approved" | "declined" | "info_requested" | "error";

export type TraceStep = {
  agent: string;
  kind: "tool_call" | "tool_result" | "thinking" | "final" | "error";
  tool?: string;
  input?: unknown;
  output?: unknown;
  text?: string;
  at: string;
};

export type AutomationStep = { step: string; detail: string; at: string };

export type Bid = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  source: { from: string; subject: string; body: string };
  intake?: any;
  estimate?: any;
  review?: any;
  trace: TraceStep[];
  automation: AutomationStep[];
  routing?: {
    priority: "P1" | "P2" | "P3";
    priorityReason: string;
    assignee: string;
    reviewDueAt: string;
    overdue?: boolean;
  };
  decision?: { action: "approved" | "declined" | "info_requested"; by: string; note: string; at: string };
  error?: string;
  model?: string;
};

export const now = () => new Date().toISOString();

export async function getBid(id: string): Promise<Bid | null> {
  return (await bids().get(id, { type: "json" })) as Bid | null;
}

export async function saveBid(bid: Bid): Promise<Bid> {
  bid.updatedAt = now();
  await bids().setJSON(bid.id, bid);
  return bid;
}

export async function updateBid(id: string, fn: (b: Bid) => void): Promise<Bid> {
  const bid = await getBid(id);
  if (!bid) throw new Error(`Bid ${id} not found`);
  fn(bid);
  return saveBid(bid);
}

export async function listBids(): Promise<Bid[]> {
  const { blobs } = await bids().list();
  const all = await Promise.all(blobs.map((b) => getBid(b.key)));
  return (all.filter(Boolean) as Bid[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type Notification = { id: string; bidId: string; title: string; body: string; level: "info" | "warn" | "urgent"; at: string; read: boolean };

export async function notify(n: Omit<Notification, "id" | "at" | "read">) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await notes().setJSON(id, { ...n, id, at: now(), read: false });
}

export async function listNotifications(): Promise<Notification[]> {
  const { blobs } = await notes().list();
  const all = await Promise.all(blobs.map((b) => notes().get(b.key, { type: "json" })));
  return (all.filter(Boolean) as Notification[]).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
}

export async function markAllRead() {
  const list = await listNotifications();
  await Promise.all(list.filter((n) => !n.read).map((n) => notes().setJSON(n.id, { ...n, read: true })));
}
