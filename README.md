# BidDesk

AI bid-request triage for a commercial electrical contractor. CU Boulder AI Club · Applied AI Development Program capstone.

**User:** the estimator at an electrical contractor (modeled on Custom Electric & Communications, Hopkinton MA).
**Problem:** general contractors send more bid invitations than an estimating team can read. Each one has to be scoped and judged go/no-go before anyone spends hours on a takeoff.

## How it works

1. **Trigger:** a GC submits through the bid portal, or a signed-in estimator logs a bid email (`POST /api/submit`).
2. **Intake Agent:** extracts scope items, each backed by a word-for-word source quote. The server checks every quote and quantity against the original text. Items that fail are left out of the estimate and listed for a human. Travel distance, crew capacity and GC history come from server lookups, not from the model.
3. **Estimator Agent:** maps every verified scope item to a price-book code or an explicit allowance. Quantities and allowances are range-checked, and code computes all totals. The model never does arithmetic.
4. **Reviewer Agent:** checks the soft go/no-go criteria, recommends pursue / decline / needs_info, lists what a human must verify, and drafts a reply to the GC. Hard rules are enforced in code afterwards (see Safety design).
5. **Automation** (separate, deterministic, triggered by the `bid.analyzed` event): score priority → route to the right reviewer → schedule the human-review deadline → notify → enter review queue.
6. **Scheduled automation** (hourly): flags reviews that pass their deadline. It never changes a human decision.
7. **Human in the loop:** a signed-in estimator approves, requests info, or declines. The decision is recorded under their name. Nothing is sent to a GC automatically.

## Stack

Static HTML + Netlify Functions (TypeScript) · Netlify AI Gateway (Anthropic Claude, no API key in code) · Netlify Blobs for storage · background, event and scheduled functions.

```
netlify/functions/  submit, process-bid (agents), on-bid-event (automation), review-sweep (cron), api, auth
netlify/lib/        agents, agent-runtime, automation, rules, security, auth, http, store, sweep, company-data
public/             dashboard (index.html, app.js), GC portal (portal.html, portal.js)
tests/              security regression tests
```

## Setup

BidDesk needs two environment variables. Set them in Netlify under **Project configuration → Environment variables** (scope: Functions, mark as secret). Never commit them. See `.env.example`.

| Variable | What it is |
| --- | --- |
| `BIDDESK_SESSION_SECRET` | 32+ random characters used to sign sessions. Generate with `openssl rand -hex 32`. |
| `BIDDESK_USERS` | `Name=code;Name=code`. Each code is at least 12 characters. The name is recorded as "decided by". |

Optional caps (defaults): `BIDDESK_PUBLIC_DAILY_LIMIT=25`, `BIDDESK_VISITOR_HOURLY_LIMIT=3`, `BIDDESK_VISITOR_DAILY_LIMIT=5`, `BIDDESK_STAFF_DAILY_LIMIT=60`.

Without these variables, the desk stays locked and submissions are refused.

Tests: `npm test` (Node 22.18+).

## Safety design

**Access**
- Every desk route requires sign-in with a per-person access code. Sessions are HMAC-signed, HttpOnly, SameSite=Strict cookies that last 12 hours. Changing a code ends that person's sessions.
- State-changing requests must come from the site itself (Origin check).
- The pipeline and automation endpoints accept only calls carrying a server-derived internal key.
- Login attempts are rate-limited.

**Cost**
- The public portal has a daily cap for the whole site plus hourly and daily caps per visitor (hashed IP), on top of Netlify's per-IP rate limit.
- A honeypot field silently drops bots.
- Each bid is capped at 22 model calls across the three agents.

**Prompt injection**
- Bid text is wrapped in a randomly named tag that a sender can't predict, and lookalike tags are stripped.
- Phrases that try to instruct the AI are detected, flagged on the dashboard, and raise the bid's priority for a human read.
- Detection is only a tripwire. The real protection is that the AI's word isn't final:
  - Facts (distance, crew, GC history) are computed by the server.
  - Hard rules (service area, job size, bonding, declined project types) are checked in code. They can only make a decision more cautious, never less.
- GC history requires an exact company-name match **and** a sender email domain that GC uses.

**Data integrity**
- Unverified scope items are never priced.
- Quantities and allowances have sane limits.
- Human decisions are stored separately from pipeline data, so the hourly sweep can't overwrite them.

**Browser**
- All model and user text is HTML-escaped before rendering.
- A Content-Security-Policy allows only the site's own script files, so injected markup can't run even if escaping failed.
- Internal errors are logged with a reference ID. The browser only sees a generic message.

**Known limits**
- Project type is still extracted by the AI.
- Sender identity is based on the email domain, which can be spoofed.
- The dashboard flags both so a human checks them.

Price book, criteria, crew schedule and GC history are **illustrative sample data**, not real company figures.
