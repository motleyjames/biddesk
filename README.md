# BidDesk

AI bid-request triage for a commercial electrical contractor. CU Boulder AI Club · Applied AI Development Program capstone.

**User:** the estimator at an electrical contractor (modeled on Custom Electric & Communications, Hopkinton MA).
**Problem:** general contractors send more bid invitations than an estimating team can read. Each one has to be scoped and judged go/no-go before anyone spends hours on a takeoff.

## How it works

1. **Trigger:** an estimator pastes a GC's bid invitation (`POST /api/submit`).
2. **Intake Agent:** extracts scope items, each backed by a word-for-word source quote that the server checks against the original text. It decides which lookups to run (travel distance, crew capacity, GC history).
3. **Estimator Agent:** searches the company price book and maps every scope item to a price-book code or an explicit allowance. Code computes all totals; the model never does arithmetic.
4. **Reviewer Agent:** checks every go/no-go criterion (pass/fail/unknown), recommends pursue / decline / needs_info, lists what a human must verify, and drafts a reply to the GC.
5. **Automation** (separate, deterministic, triggered by the `bid.analyzed` event): score priority → route to the right reviewer → schedule the human-review deadline → notify → enter review queue.
6. **Scheduled automation** (hourly): escalates reviews that pass their deadline.
7. **Human in the loop:** the estimator approves, requests info, or declines. Nothing is sent to a GC automatically.

## Stack

Static HTML + Netlify Functions (TypeScript) · Netlify AI Gateway (Anthropic Claude, no API key in code) · Netlify Blobs for storage · background, event and scheduled functions.

```
netlify/functions/  submit, process-bid (agents), on-bid-event (automation), review-sweep (cron), api
netlify/lib/        agents, agent-runtime (tool-use loop), automation, store, company-data
public/             dashboard
```

## Safety design

- Bid text is treated as untrusted data; prompt-injection attempts are flagged, not obeyed (see the "Injection test" sample).
- Scope items whose quotes aren't found in the request are sent back to the agent once, then flagged.
- Unknown price-book codes are rejected; all money math is done in code.
- Every agent tool call is logged and visible in the Agent trace tab.

Price book, criteria, crew schedule and GC history are **illustrative sample data**, not real company figures.
