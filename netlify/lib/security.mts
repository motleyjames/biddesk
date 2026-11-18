// Pure safety helpers used by the agents and functions. No Netlify imports, so they're unit-testable.
import { randomBytes } from "node:crypto";
import { GC_HISTORY, TRAVEL_TABLE, CREW_CAPACITY, type GcRecord } from "./company-data.mts";

/* ---------------- untrusted text going into prompts ---------------- */

// Wrap outside text in a tag whose name the sender can't know in advance, and strip anything
// that looks like our tags, so bid text can't "close" the block and pose as instructions. (#6)
export function wrapUntrusted(text: string, label = "bid_request") {
  const tag = `${label}_${randomBytes(6).toString("hex")}`;
  const cleaned = String(text ?? "").replace(/<\s*\/?\s*[a-z_]*(bid_request|intake|estimate|unverified|instructions?|system)[a-z0-9_]*[^>]*>/gi, "[tag removed]");
  return { tag, block: `<${tag}>\n${cleaned}\n</${tag}>` };
}

// JSON for prompts with < and > escaped, so values derived from bid text can't form tags. (#6)
export function promptJson(value: unknown) {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

// Phrases that look like someone trying to instruct the AI. Detection is a tripwire for humans;
// the real defenses are the code-enforced rules and server-side facts. (#6)
const INJECTION_PATTERNS: [RegExp, string][] = [
  [/\bignore\b.{0,40}\b(instructions?|rules?|criteria|prompt|guidelines?)\b/i, "asks to ignore instructions or rules"],
  [/\b(system|developer|admin)\s*(note|prompt|message|instruction|override)\b/i, "poses as a system or developer message"],
  [/\b(ai|ai assistant|chatbot|language model|llm|claude|gpt|chatgpt)\b.{0,60}\b(must|should|mark|set|score|approve|ignore|omit|do not|don'?t)\b/i, "gives orders to the AI"],
  [/\bfit[_ ]?score\b.{0,20}\b\d{2,3}\b/i, "dictates a fit score"],
  [/\bmark\b.{0,30}\bas\b.{0,10}\b(pursue|approved?|preferred)\b/i, "dictates the recommendation"],
  // Tag-like markup such as </bid_request> or <system>. Email addresses like <dana@gc.com> don't match.
  [/<\s*\/?\s*[a-z_]{3,}(\s[^>]*)?>/i, "contains markup tags"],
];
export function detectInjection(text: string) {
  const signals = INJECTION_PATTERNS.filter(([re]) => re.test(text)).map(([, why]) => why);
  return { suspected: signals.length > 0, signals };
}

/* ---------------- facts the server computes itself ---------------- */

export function normalizeCompany(name: string) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|inc|incorporated|llc|ltd|co|corp|corporation|company)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function senderDomain(from: string) {
  const m = String(from ?? "").match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  return m ? m[1].toLowerCase() : null;
}

export type GcLookup = { gc: string; status: "preferred" | "good" | "caution" | "new" | "unverified"; jobs: number; wins: number; note: string };

// Exact (normalized) name match, and the sender's email domain must be one that GC uses. (#8)
export function lookupGc(gcName: string, from: string): GcLookup {
  const key = normalizeCompany(gcName);
  const rec: GcRecord | undefined = key ? GC_HISTORY[key] : undefined;
  if (!rec) return { gc: gcName, status: "new", jobs: 0, wins: 0, note: "No history with this company." };
  const domain = senderDomain(from);
  if (!domain || !rec.domains.includes(domain)) {
    return { gc: key, status: "unverified", jobs: 0, wins: 0, note: `Name matches a known GC, but the sender's email${domain ? ` (@${domain})` : ""} isn't one they use. Treat as a new GC until someone confirms who sent this.` };
  }
  return { gc: key, status: rec.status, jobs: rec.jobs, wins: rec.wins, note: rec.note };
}

export function lookupMiles(town: string, state: string): number | null {
  const key = `${String(town ?? "").toLowerCase().trim()},${String(state ?? "").toLowerCase().trim()}`;
  return TRAVEL_TABLE[key] ?? null;
}

export function lookupCrew(month: string | null | undefined): number | null {
  return month && CREW_CAPACITY[month] ? CREW_CAPACITY[month].openPct : null;
}

/* ---------------- verifying what the Intake agent extracted ---------------- */

export const normText = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9$.]+/g, " ").replace(/\s+/g, " ").trim();
const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };

// An item counts only if its quote appears in the original text AND its quantity appears in the quote. (#10)
export function verifyScopeItem(item: { source_quote?: string; quantity?: number | null }, haystack: string) {
  const quote = normText(item.source_quote ?? "");
  if (quote.length < 4 || !haystack.includes(quote)) return { ok: false, reason: "quote not found in the request" };
  if (item.quantity == null) return { ok: true, reason: "" };
  const q = Number(item.quantity);
  const nums = (quote.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const words = quote.split(" ").map((w) => WORD_NUMBERS[w]).filter((n) => n != null);
  if (nums.includes(q) || words.includes(q)) return { ok: true, reason: "" };
  return { ok: false, reason: `quantity ${q} isn't stated in the quote` };
}

/* ---------------- validating model output ---------------- */

export const str = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
export const strList = (v: unknown, maxItems: number, maxLen: number) => (Array.isArray(v) ? v : []).slice(0, maxItems).map((x) => str(x, maxLen)).filter(Boolean);
export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback;
export function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Sane limits per price-book unit, so one bad line can't swing totals or routing. (#9)
export const QTY_LIMITS: Record<string, number> = { EA: 5_000, LF: 50_000, MO: 36, WK: 104 };
export const MAX_ALLOWANCE = 250_000;
export const MAX_LINES = 80;
export const MAX_ALLOWANCES = 15;
