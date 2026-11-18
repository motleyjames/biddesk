// BidDesk estimating desk. Plain JS, no build step.
// Safety rules for this file (#5):
//   - Every value from the server goes through esc(), num(), or a whitelist before it reaches HTML.
//   - No inline event handlers: clicks are handled by data-action delegation, so the page can run
//     under a Content-Security-Policy that blocks all inline script.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const pct = (v) => Math.max(0, Math.min(100, Math.round(num(v))));
const fmt = (v, digits = 0) => esc(num(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const usd = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : "$" + fmt(Math.round(v)));
const usd2 = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : "$" + fmt(v, 2));
const pick = (map, key, fallback = "") => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback);
const safeDate = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d; };
const when = (iso) => { const d = safeDate(iso); return d ? esc(d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) : ""; };
const clock = (iso) => { const d = safeDate(iso); return d ? esc(d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })) : ""; };

const WORKING = ["received", "intake", "estimating", "reviewing", "analyzed"];
const DONE = ["approved", "declined", "info_requested"];
const CALL = { pursue: "Pursue", decline: "Decline", needs_info: "Needs info" };
const WIRE = { pursue: "var(--go)", decline: "var(--no)", needs_info: "var(--ask)", approved: "var(--go)", declined: "var(--no)", info_requested: "var(--ask)" };
const TAGCLASS = { pursue: "go", decline: "no", needs_info: "ask", approved: "go", declined: "no", info_requested: "ask" };
const HUMAN = { approved: "Approved to bid", declined: "Declined", info_requested: "Questions sent to GC" };
const STAGE = { received: "Queued", intake: "Reading the invite", estimating: "Pricing the scope", reviewing: "Checking the rules", analyzed: "Routing" };
const RESULT = { pass: "pass", fail: "fail", unknown: "unknown" };
const GC_LABEL = { preferred: "Preferred", good: "Good", caution: "Caution", new: "New to CEC", unverified: "Unverified sender" };
const SECTIONS = { overview: "Rules & risks", estimate: "Estimate", scope: "Scope", agents: "Agent activity", emails: "Emails" };

const state = { user: null, list: [], view: "review", selected: null, bid: null, section: "overview", showAllChecks: false, ticked: {}, editing: false };

class AuthError extends Error {}
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { showLogin(); throw new AuthError(data.error || "Sign in to continue."); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = "none"), 2600); }

/* ---------------- sign in ---------------- */
function showLogin(message = "") {
  state.user = null;
  document.body.classList.add("signed-out");
  $("#who").hidden = true;
  $("#main").innerHTML = `<form class="login" id="loginForm" autocomplete="off">
      <h1>Sign in to the estimating desk</h1>
      <p>Bids, pricing and contractor details are private to CEC estimators. Use the access code your admin gave you.</p>
      <label for="code">Access code</label>
      <input id="code" name="code" type="password" required autocomplete="current-password" />
      <div class="err" id="loginErr" ${message ? "" : "hidden"}>${esc(message)}</div>
      <button class="btn dark" type="submit">Sign in</button>
      <p class="hint">General contractors don’t need an account: they use the <a href="/portal.html">bid portal</a>.</p>
    </form>`;
  setTimeout(() => $("#code")?.focus(), 30);
}
async function signIn(code) {
  const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Sign-in failed.");
  return data.user;
}
async function start() {
  const r = await fetch("/api/session");
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.user) return showLogin(data.configured === false ? "Sign-in isn’t set up yet. Ask your admin to add BidDesk’s access codes in Netlify." : "");
  state.user = data.user;
  document.body.classList.remove("signed-out");
  $("#who").hidden = false;
  $("#whoName").textContent = data.user.name;
  await loadQueue();
  const hash = location.hash.slice(1);
  if (hash) await select(hash);
  else if (state.list.length) { const first = state.list.find((b) => bucket(b) === "review") || state.list[0]; await select(first.id); }
  else renderWelcome();
  loadNotes();
  schedule();
}

/* ---------------- queue ---------------- */
function bucket(b) {
  if (WORKING.includes(b.status) || b.status === "error") return "working";
  if (DONE.includes(b.status)) return "decided";
  return "review";
}
function renderViews() {
  const counts = { review: 0, working: 0, decided: 0 };
  state.list.forEach((b) => counts[bucket(b)]++);
  const views = [["review", "To review"], ["working", "In progress"], ["decided", "Decided"]];
  $("#views").innerHTML = views.map(([k, l]) => `<button aria-pressed="${state.view === k}" data-action="view" data-arg="${k}">${l}<span>${num(counts[k])}</span></button>`).join("");
  const review = state.list.filter((b) => bucket(b) === "review");
  const overdue = review.filter((b) => b.overdue || (b.reviewDueAt && safeDate(b.reviewDueAt) < new Date())).length;
  const pursued = state.list.filter((b) => b.humanDecision === "approved" || (!b.humanDecision && b.decision === "pursue")).reduce((s, b) => s + num(b.total), 0);
  $("#tally").innerHTML = `<div><b>${num(review.length)}</b>to review</div><div class="${overdue ? "hot" : ""}"><b>${num(overdue)}</b>overdue</div><div><b>${usd(pursued)}</b>in play</div>`;
}
function renderQueue() {
  renderViews();
  const items = state.list.filter((b) => bucket(b) === state.view);
  if (!items.length) {
    const msg = { review: ["Nothing waiting on you", "New bids land here once the agents finish."], working: ["No bids in progress", "Submit one from the GC bid portal or log an email."], decided: ["No decisions yet", "Bids you approve, decline or question move here."] }[state.view];
    $("#list").innerHTML = `<div class="empty"><b>${msg[0]}</b>${msg[1]}</div>`;
    return;
  }
  $("#list").innerHTML = items.map((b) => {
    const tags = [];
    if (WORKING.includes(b.status)) tags.push(`<span class="tag live">${esc(pick(STAGE, b.status))}</span>`);
    if (b.status === "error") tags.push(`<span class="tag no">Stopped</span>`);
    if (b.humanDecision) tags.push(`<span class="tag ${pick(TAGCLASS, b.humanDecision)}">${pick(HUMAN, b.humanDecision)}</span>`);
    else if (b.decision) tags.push(`<span class="tag ${pick(TAGCLASS, b.decision)}">${pick(CALL, b.decision)}</span>`);
    if (b.priority === "P1" && !b.humanDecision) tags.push(`<span class="tag p1">Urgent</span>`);
    if (b.overdue && !b.humanDecision) tags.push(`<span class="tag late">Overdue</span>`);
    if (b.injection) tags.push(`<span class="tag warn">Check text</span>`);
    const wire = pick(WIRE, b.humanDecision || b.decision, WORKING.includes(b.status) ? "var(--copper)" : "var(--line-2)");
    return `<button class="item" style="--wire:${wire}" aria-current="${state.selected === b.id}" data-action="select" data-arg="${esc(b.id)}">
      <div class="t">${esc(b.project || b.subject)}</div>
      <div class="m">${tags.join("")}<span>${esc(b.gc || b.from)}</span>${b.total ? `<span class="amt">${usd(b.total)}</span>` : ""}</div>
    </button>`;
  }).join("");
}
async function loadQueue() {
  try { state.list = await api("/api/bids"); } catch (e) { if (!(e instanceof AuthError)) $("#list").innerHTML = `<div class="empty"><b>Couldn't load bids</b>${esc(e.message)}</div>`; return; }
  const cur = state.list.find((b) => b.id === state.selected);
  if (cur) { const bk = bucket(cur); if (state.selBucket && bk !== state.selBucket) state.view = bk; state.selBucket = bk; }
  renderQueue();
}
async function select(id, opts = {}) {
  if (!/^bid-[a-z0-9-]{6,24}$/.test(id)) return;
  state.selected = id;
  state.showAllChecks = false;
  state.ticked = {};
  state.editing = false;
  history.replaceState(null, "", `#${id}`);
  const b = state.list.find((x) => x.id === id);
  if (!opts.keepSection) state.section = b && bucket(b) === "working" ? "agents" : "overview";
  if (b && bucket(b) !== state.view) state.view = bucket(b);
  state.selBucket = b ? bucket(b) : null;
  renderQueue();
  await loadBid();
  if (innerWidth < 960) $("#main").scrollIntoView({ behavior: "smooth" });
}
async function loadBid() {
  if (!state.selected) return renderWelcome();
  try { state.bid = await api(`/api/bids/${encodeURIComponent(state.selected)}`); } catch (e) { if (!(e instanceof AuthError)) $("#main").innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  renderBid();
}

/* ---------------- plain-English agent steps ---------------- */
function describe(tool, input, output) {
  const o = output || {}, i = input || {};
  switch (tool) {
    case "lookup_travel_distance": return o.found ? `Measured the drive: ${i.town}, ${i.state} is ${num(o.miles_from_hopkinton)} miles from Hopkinton.` : `Couldn't find ${i.town}, ${i.state} in the distance table, so distance is unknown.`;
    case "check_crew_capacity": return o.open_pct != null ? `Checked the crew schedule for ${i.month}: ${pct(o.open_pct)}% of capacity open.` : `No crew schedule for ${i.month} yet.`;
    case "check_gc_history":
      if (o.status === "new") return `Looked up ${i.gc_name}: no history with CEC.`;
      if (o.status === "unverified") return `Looked up ${i.gc_name}: the name matches a known GC, but the sender's email doesn't, so history wasn't used.`;
      return `Looked up ${i.gc_name}: ${pick(GC_LABEL, o.status, "unknown").toLowerCase()} relationship, ${num(o.wins)} of ${num(o.jobs)} bids won. ${o.note || ""}`;
    case "search_price_book": { const hits = Array.isArray(o) ? o : []; return hits.length ? `Searched the price book for “${i.query}” and found ${hits[0].description} (${hits[0].code})${hits.length > 1 ? ` plus ${hits.length - 1} more` : ""}.` : `Searched the price book for “${i.query}”: no match.`; }
    case "get_bid_criteria": return `Loaded CEC’s ${Array.isArray(o) ? o.length : ""} go / no-go rules.`;
    case "find_similar_past_jobs": return Array.isArray(o) ? `Pulled ${o.length} past ${String(i.project_type).replace(/_/g, " ")} jobs to compare against.` : `No past ${String(i.project_type).replace(/_/g, " ")} jobs to compare against.`;
    case "count_business_days": return o.business_days_until_due != null ? `Counted ${num(o.business_days_until_due)} business days until the ${o.due} bid deadline.` : `Couldn't read the due date.`;
    default: return `Used ${tool}.`;
  }
}
function finalLine(tool, input) {
  const i = input || {};
  const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  if (tool === "submit_intake") return `Handed off ${n((i.scope_items || []).length, "scope item")} and ${n((i.missing_info || []).length, "open question")} to the Estimator.`;
  if (tool === "submit_estimate") return `Handed off ${n((i.lines || []).length, "priced line")} and ${n((i.allowances || []).length, "allowance")} to the Reviewer. Confidence: ${i.confidence}.`;
  if (tool === "submit_recommendation") return `Recommended: ${pick(CALL, i.decision, "unknown")}, fit ${pct(i.fit_score)}/100.`;
  return `Submitted ${tool}.`;
}
function lanes(trace) {
  const order = ["Intake Agent", "Estimator Agent", "Reviewer Agent", "System"];
  const pending = {}, out = {};
  for (const t of trace || []) {
    if (!order.includes(t.agent)) continue;
    const lane = (out[t.agent] ||= []);
    if (t.kind === "tool_call") { (pending[t.tool] ||= []).push(t.input); }
    else if (t.kind === "tool_result") { const inp = (pending[t.tool] || []).shift(); lane.push({ at: t.at, cls: "", text: describe(t.tool, inp, t.output), raw: t.output }); }
    else if (t.kind === "final") lane.push({ at: t.at, cls: "final", text: finalLine(t.tool, t.input), raw: t.input });
    else if (t.kind === "error") lane.push({ at: t.at, cls: "bad", text: String(t.text || "").startsWith("Rejected") ? `Sent back by the server: ${String(t.text).replace(/^Rejected:\s*/, "")}` : String(t.text || "") });
    else if (t.kind === "thinking") lane.push({ at: t.at, cls: "thought", text: String(t.text || "") });
  }
  return order.filter((a) => out[a]).map((a) => [a, out[a]]);
}
const ROLE = { "Intake Agent": "Reads the invite and gathers context", "Estimator Agent": "Prices the scope from the price book", "Reviewer Agent": "Checks CEC’s rules and makes the call", System: "Pipeline" };

/* ---------------- screens ---------------- */
function renderWelcome() {
  $("#main").innerHTML = `<div class="welcome">
    <h1>Bid invitations, read and priced before you open them.</h1>
    <p>When a general contractor invites CEC to bid, three agents take the first pass. One reads the invite, one prices it from the price book, and one checks it against CEC’s bid rules. BidDesk then routes it to the right estimator with a deadline. You make the call.</p>
    <div class="acts"><a class="btn dark" href="/portal.html" target="_blank" rel="noopener">Open the GC bid portal</a><button class="btn" data-action="openLog">Log a bid email</button></div>
  </div>`;
}

function node(label, sub, cls) { return `<div class="node ${cls}"><div class="pt"></div><b>${label}</b><small>${esc(sub)}</small></div>`; }
function oneLine(b) {
  const i = b.intake || {}, e = b.estimate, r = b.review, rt = b.routing;
  const st = b.status;
  const idx = pick({ received: 0, intake: 0, estimating: 1, reviewing: 2, analyzed: 3, awaiting_review: 4 }, st, DONE.includes(st) ? 5 : 0);
  const errAt = st === "error" ? [!!b.intake, !!b.estimate, !!b.review].indexOf(false) : -1;
  const cls = (k) => (errAt === k ? "err" : st === "error" ? (k < errAt ? "done" : "") : k < idx ? "done" : k === idx ? "now" : "");
  const fill = st === "error" ? Math.max(0, errAt) * 25 : Math.min(idx, 4) * 25;
  return `<div class="oneline" aria-label="Pipeline progress"><div class="row">
    <div class="wire"><i style="--fill:${num(fill)}%"></i></div>
    ${node("Intake", i.project_name ? `${(i.scope_items || []).length} scope items verified` : "Reading the invite", cls(0))}
    ${node("Estimate", e ? `${usd(e.totals?.total)} budget` : "Pricing the scope", cls(1))}
    ${node("Review", r ? `${pick(CALL, r.decision)}, fit ${pct(r.fit_score)}` : "Checking the rules", cls(2))}
    ${node("Route", rt ? String(rt.assignee || "") : "Priority and deadline", cls(3))}
    ${node("You", b.decision ? pick(HUMAN, b.decision.action) : rt ? `Due ${safeDate(rt.reviewDueAt)?.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) ?? ""}` : "Final decision", cls(4))}
  </div></div>`;
}

function renderBid() {
  const b = state.bid, i = b.intake || {}, e = b.estimate, r = b.review, rt = b.routing;
  const working = WORKING.includes(b.status);
  const where = [i.location_town, i.location_state].filter(Boolean).join(", ");
  const tags = [];
  if (rt?.priority === "P1" && !b.decision) tags.push(`<span class="tag p1">Urgent</span>`);
  if (rt?.overdue && !b.decision) tags.push(`<span class="tag late">Overdue</span>`);
  if (working) tags.push(`<span class="tag live">${esc(pick(STAGE, b.status))}</span>`);
  if (b.source?.channel === "portal") tags.push(`<span class="tag">From bid portal</span>`);

  let html = `<div class="head"><div>
      <h1>${esc(i.project_name || b.source?.subject)}</h1>
      <div class="sub">${[i.gc_name || b.source?.from, where, i.bid_due_date ? `Bids due ${i.bid_due_date}` : ""].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
    </div><div class="tags">${tags.join("")}</div></div>
    ${oneLine(b)}
    ${b.error ? `<div class="err"><b>The pipeline stopped.</b> ${esc(b.error)}</div>` : ""}
    ${b.security?.suspected ? `<div class="alert"><b>Read this one yourself.</b> The request contains text aimed at the AI (${esc((b.security.signals || []).join("; "))}). It was treated as data, and code re-checked the hard rules, but a person should look at the original.</div>` : ""}`;

  if (r && e) {
    const wire = pick(WIRE, r.decision, "var(--line-2)");
    html += `<section class="verdict" style="--wire:${wire}" aria-label="Recommendation">
      <div class="say">
        <div class="call"><strong>${pick(CALL, r.decision)}</strong><div class="fit"><div class="meter" aria-hidden="true"><i style="width:${pct(r.fit_score)}%"></i></div>Fit ${pct(r.fit_score)} of 100</div></div>
        ${r.override ? `<p class="override">${esc(r.override)} The agent said ${esc(pick(CALL, r.ai_decision, "something else"))}.</p>` : ""}
        <p class="lead">${esc(r.headline)}</p>
        <p class="why">${esc(r.rationale)}</p>
      </div>
      <dl class="facts">
        <div class="big"><span>Budget estimate · ${esc(e.confidence)} confidence</span><b>${usd(e.totals?.total)}</b></div>
        <dt>Distance</dt><dd>${i.travel_miles != null ? `${fmt(i.travel_miles)} mi from Hopkinton` : "Unknown"}</dd>
        <dt>Crew open</dt><dd>${i.crew_capacity_open_pct != null ? `${pct(i.crew_capacity_open_pct)}% that month` : "Unknown"}</dd>
        <dt>GC record</dt><dd>${esc(pick(GC_LABEL, i.gc_status, "—"))}</dd>
        <dt>Labor</dt><dd>${fmt(Math.round(num(e.totals?.labor_hours)))} hours</dd>
      </dl>
    </section>`;
  }

  if (b.decision && !state.editing) {
    html += `<section class="decide decided" style="--wire:${pick(WIRE, b.decision.action, "var(--line-2)")}"><h2>${pick(HUMAN, b.decision.action)}</h2>
      <div class="hint">${esc(b.decision.by)} decided ${when(b.decision.at)}${b.decision.note ? `: “${esc(b.decision.note)}”` : ""}</div>
      <div class="row"><button class="btn" data-action="section" data-arg="emails">See the reply to the GC</button><button class="btn" data-action="reopen">Change decision</button></div></section>`;
  } else if ((b.status === "awaiting_review" || state.editing) && r) {
    const flags = Array.isArray(r.human_review_flags) ? r.human_review_flags : [];
    const shown = state.showAllChecks ? flags : flags.slice(0, 4);
    html += `<section class="decide" aria-label="Your decision"><h2>Your call</h2>
      <div class="hint">Check these before deciding. Nothing reaches the GC until you choose. You’re signed in as ${esc(state.user?.name)}.${rt ? ` Assigned to ${esc(rt.assignee)}, due ${when(rt.reviewDueAt)}.` : ""}</div>
      <ul class="checks">${shown.map((f, k) => `<li><label><input type="checkbox" data-tick="${k}" ${state.ticked[k] ? "checked" : ""}> ${esc(f)}</label></li>`).join("")}</ul>
      ${flags.length > 4 ? `<button class="more" data-action="toggleChecks">${state.showAllChecks ? "Show fewer" : `Show all ${flags.length} checks`}</button>` : ""}
      <div class="row"><textarea id="dNote" aria-label="Note for the record" maxlength="1000" placeholder="Note for the record (optional)"></textarea>
        <button class="btn go" data-action="decide" data-arg="approved">Approve bid</button>
        <button class="btn ask" data-action="decide" data-arg="info_requested">Ask GC questions</button>
        <button class="btn no" data-action="decide" data-arg="declined">Decline</button></div></section>`;
  }

  html += `<div class="switch" role="tablist">${Object.entries(SECTIONS).map(([k, l]) => `<button role="tab" aria-selected="${state.section === k}" data-action="section" data-arg="${k}">${l}</button>`).join("")}</div>
    <div id="section">${renderSection(b)}</div>
    <p class="foot">Price book, bid rules, crew schedule and GC history are sample data for this demo. ${b.model ? `Agents run on ${esc(b.model)} through Netlify AI Gateway.` : ""}</p>`;
  $("#main").innerHTML = html;
}

function wait(b, who) { return `<div class="panel empty">${b.status === "error" ? "The pipeline stopped before this step." : `<b>Working on it</b>The ${who} hasn’t finished yet. Watch it live under Agent activity.`}</div>`; }
const list = (arr) => (Array.isArray(arr) ? arr : []);

function renderSection(b) {
  const i = b.intake, e = b.estimate, r = b.review;
  switch (state.section) {
    case "overview": {
      if (!r) return wait(b, "Reviewer agent");
      const ruleRow = (label, result, note) => `<div class="rule"><span class="res ${pick(RESULT, result, "unknown")}">${pick(RESULT, result, "unknown")}</span><div><b>${esc(label)}</b><span>${esc(note)}</span></div></div>`;
      return `<div class="grid2"><div>
          ${list(r.rule_checks).length ? `<div class="panel"><h3>Hard rules <small>checked by code, not the AI</small></h3>${list(r.rule_checks).map((c) => ruleRow(c.rule, c.result, c.note)).join("")}</div>` : ""}
          <div class="panel"><h3>The agent’s review</h3>${list(r.criteria_checks).map((c) => ruleRow(String(c.criterion || "").replace(/_/g, " "), c.result, c.note)).join("")}</div></div>
        <div><div class="panel"><h3>Risks</h3>${list(r.risks).length ? `<ul class="plain">${list(r.risks).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p>None flagged.</p>"}</div>
        <div class="panel"><h3>Questions for the GC</h3>${list(r.questions_for_gc).length ? `<ul class="plain">${list(r.questions_for_gc).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p>None.</p>"}</div></div></div>`;
    }
    case "estimate": {
      if (!e) return wait(b, "Estimator agent");
      const t = e.totals || {};
      return `<div class="panel scroll"><h3>Priced from the CEC price book. Labor at ${usd(t.labor_rate)} per hour.</h3>
        <table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Material</th><th class="n">Labor hrs</th><th class="n">Line total</th></tr></thead><tbody>
        ${list(e.lines).map((l) => `<tr><td>${esc(l.description)} <span class="code">${esc(l.item_code)}</span>${l.note ? `<span class="note">${esc(l.note)}</span>` : ""}</td><td class="n">${fmt(l.quantity, Number.isInteger(num(l.quantity)) ? 0 : 1)} ${esc(l.unit)}</td><td class="n">${usd(l.material)}</td><td class="n">${fmt(l.labor_hours, 1)}</td><td class="n">${usd(l.line_total)}</td></tr>`).join("")}
        ${list(e.allowances).map((a) => `<tr><td>Allowance: ${esc(a.description)}<span class="note">${esc(a.reason)}</span></td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n">${usd(a.amount)}</td></tr>`).join("")}
        <tr class="sum"><td colspan="4">Direct cost</td><td class="n">${usd2(t.direct)}</td></tr>
        <tr class="sum"><td colspan="4">Overhead ${pct(num(t.overhead_pct) * 100)}%</td><td class="n">${usd2(t.overhead)}</td></tr>
        <tr class="sum"><td colspan="4">Profit ${pct(num(t.profit_pct) * 100)}%</td><td class="n">${usd2(t.profit)}</td></tr>
        <tr class="total"><td colspan="3">Budget estimate</td><td class="n">${fmt(t.labor_hours, 1)}</td><td class="n">${usd2(t.total)}</td></tr>
        </tbody></table></div>
        <div class="grid2 gap-top"><div class="panel"><h3>Assumptions</h3><ul class="plain">${list(e.assumptions).map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>
        <div class="panel"><h3>Confidence: ${esc(e.confidence)}</h3><p class="muted">${esc(e.confidence_reason)}</p><p class="quote">The agent picks items and quantities. Every dollar is calculated by code, not the AI.</p></div></div>`;
    }
    case "scope": {
      if (!i) return wait(b, "Intake agent");
      const unv = list(i.unverified_items);
      return `<div class="panel scroll"><h3>${esc(i.scope_summary)}</h3>
        <table><thead><tr><th class="mark"></th><th>Work item</th><th class="n">Qty</th><th>Where it says so in the invite</th></tr></thead><tbody>
        ${list(i.scope_items).map((s) => `<tr><td>${s.verified ? '<span class="ok" title="Quote and quantity found in the invite">✓</span>' : '<span class="bad" title="Not verified">!</span>'}</td><td>${esc(s.description)}</td><td class="n">${s.quantity == null ? "?" : fmt(s.quantity)} ${esc(s.unit || "")}</td><td class="quote">“${esc(s.source_quote)}”</td></tr>`).join("")}
        </tbody></table>
        <p class="quote">✓ means the server found that exact quote, including the quantity, in the original invite.</p></div>
        ${unv.length ? `<div class="panel"><h3>Left out of the estimate <small>couldn’t be verified</small></h3><ul class="plain">${unv.map((u) => `<li><b>${esc(u.description)}</b>: ${esc(u.problem)}. Quote given: “${esc(u.source_quote)}”</li>`).join("")}</ul></div>` : ""}
        ${list(i.missing_info).length ? `<div class="panel"><h3>Missing from the invite</h3><ul class="plain">${list(i.missing_info).map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}`;
    }
    case "agents": {
      const ls = lanes(b.trace);
      const auto = list(b.automation).length ? `<div class="panel lane"><h3>Routing automation <small>Rules, not AI. Runs when the agents finish.</small></h3><ol>${list(b.automation).map((a) => `<li class="${/error/i.test(String(a.step)) ? "bad" : ""}"><time>${clock(a.at)}</time><b>${esc(String(a.step || "").replace(/^\d+\.\s*/, ""))}.</b> ${esc(a.detail)}</li>`).join("")}</ol></div>` : "";
      if (!ls.length && !auto) return wait(b, "Intake agent");
      return `<div class="log">${ls.map(([agent, steps]) => `<div class="panel lane"><h3>${esc(agent)} <small>${esc(pick(ROLE, agent))}</small></h3><ol>${steps.map((s) => `<li class="${s.cls}"><time>${clock(s.at)}</time>${esc(s.text)}${s.raw ? `<details class="raw"><summary>Raw data</summary><pre>${esc(JSON.stringify(s.raw, null, 2))}</pre></details>` : ""}</li>`).join("")}</ol></div>`).join("")}${auto}</div>`;
    }
    case "emails":
      return `${r ? `<div class="panel"><h3>Draft reply to ${esc(i?.gc_contact || i?.gc_name || "the GC")}</h3><div class="mailhead">Not sent. Copy it into your email once you’ve decided.</div><div class="mail">${esc(r.gc_reply_draft)}</div><div class="gap-top"><button class="btn" data-action="copyReply">Copy reply</button></div></div>` : ""}
        <div class="panel"><h3>Original invitation</h3><div class="mailhead">From ${esc(b.source?.from)} · ${esc(b.source?.subject)}</div><div class="mail">${esc(b.source?.body)}</div></div>`;
  }
  return "";
}

/* ---------------- actions (one delegated listener, no inline handlers) ---------------- */
async function decide(action) {
  if (!DONE.includes(action)) return;
  const note = $("#dNote")?.value || "";
  try {
    state.bid = await api(`/api/bids/${encodeURIComponent(state.selected)}/decision`, { method: "POST", body: JSON.stringify({ action, note }) });
    state.editing = false;
    renderBid(); await loadQueue(); toast(pick(HUMAN, action));
  } catch (e) { if (!(e instanceof AuthError)) toast(e.message); }
}
const ACTIONS = {
  view: (k) => { if (["review", "working", "decided"].includes(k)) { state.view = k; renderQueue(); } },
  select: (id) => select(id),
  section: (k) => { if (k in SECTIONS) { state.section = k; renderBid(); } },
  toggleChecks: () => { state.showAllChecks = !state.showAllChecks; renderBid(); },
  decide: (a) => decide(a),
  reopen: () => { state.editing = true; renderBid(); },
  copyReply: async () => { try { await navigator.clipboard.writeText(state.bid.review.gc_reply_draft); toast("Reply copied"); } catch { toast("Couldn’t copy. Select the text instead."); } },
  openLog: () => openLog(),
};
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) { ev.preventDefault(); fn(el.dataset.arg); }
});
document.addEventListener("change", (ev) => {
  const k = ev.target?.dataset?.tick;
  if (k != null) state.ticked[Number(k)] = ev.target.checked;
});
document.addEventListener("submit", async (ev) => {
  if (ev.target.id !== "loginForm") return;
  ev.preventDefault();
  const btn = ev.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try { await signIn($("#code").value); await start(); }
  catch (e) { const el = $("#loginErr"); el.textContent = e.message; el.hidden = false; }
  finally { btn.disabled = false; }
});
$("#signOut").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  state.list = []; state.bid = null; state.selected = null;
  $("#list").innerHTML = ""; $("#tally").innerHTML = "";
  showLogin();
});

/* ---------------- log an email ---------------- */
const dlg = $("#logDialog");
function openLog() { if (!state.user) return showLogin(); $("#fErr").hidden = true; dlg.showModal(); }
$("#logBtn").addEventListener("click", openLog);
$("#examples").insertAdjacentHTML("beforeend", (window.BIDDESK_SAMPLES || []).map((s, k) => `<button type="button" data-k="${k}">${esc(s.label)}</button>`).join(""));
$("#examples").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-k]"); if (!b) return;
  const s = window.BIDDESK_SAMPLES[Number(b.dataset.k)]; if (!s) return;
  $("#fFrom").value = s.from; $("#fSubj").value = s.subject; $("#fBody").value = s.body;
});
$("#logForm").addEventListener("submit", async (ev) => {
  if (ev.submitter?.value === "cancel") return;
  ev.preventDefault();
  const btn = $("#logSubmit"); btn.disabled = true; btn.textContent = "Starting…";
  try {
    const { id } = await api("/api/submit", { method: "POST", body: JSON.stringify({ channel: "email", from: $("#fFrom").value, subject: $("#fSubj").value, body: $("#fBody").value }) });
    dlg.close(); ["#fFrom", "#fSubj", "#fBody"].forEach((s) => ($(s).value = ""));
    await loadQueue(); state.section = "agents"; await select(id, { keepSection: true }); toast("Agents started");
    schedule();
  } catch (e) { $("#fErr").textContent = e.message; $("#fErr").hidden = false; }
  finally { btn.disabled = false; btn.textContent = "Start analysis"; }
});

/* ---------------- notifications ---------------- */
async function loadNotes() {
  try {
    const items = await api("/api/notifications");
    const unread = items.filter((n) => !n.read).length;
    $("#bellDot").hidden = !unread; $("#bellDot").textContent = String(num(unread));
    $("#notes").innerHTML = items.length ? items.map((n) => `<button class="note ${n.read ? "" : "unread"}" data-action="openNote" data-arg="${esc(n.bidId)}"><b>${esc(String(n.title || "").replace(/^P\d · /, ""))}</b><span>${esc(n.body)}</span><time>${when(n.at)}</time></button>`).join("") : `<div class="empty"><b>No notifications</b>You’ll hear here when a bid is routed to you.</div>`;
  } catch {}
}
ACTIONS.openNote = (id) => { $("#drawer").classList.remove("open"); select(id); };
$("#bellBtn").addEventListener("click", async () => { $("#drawer").classList.add("open"); await api("/api/notifications", { method: "POST" }).catch(() => {}); setTimeout(loadNotes, 400); });
$("#closeDrawer").addEventListener("click", () => $("#drawer").classList.remove("open"));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#drawer").classList.remove("open"); });

/* ---------------- live updates (#16) ---------------- */
// Fast polling only while a bid is being analyzed; slow otherwise; none while the tab is hidden.
// The bid list request is answered with 304 Not Modified when nothing changed.
let timer = null, ticks = 0;
function schedule() {
  clearTimeout(timer);
  if (!state.user || document.hidden) return;
  const busy = state.list.some((b) => WORKING.includes(b.status));
  timer = setTimeout(tick, busy ? 3000 : 15000);
}
async function tick() {
  if (!state.user) return;
  await loadQueue();
  const b = state.bid;
  if (state.selected && b && (WORKING.includes(b.status) || (b.status === "awaiting_review" && !list(b.automation).length))) {
    const typing = document.activeElement?.id === "dNote";
    const y = scrollY;
    if (!typing) { await loadBid(); scrollTo(0, y); }
  }
  if (++ticks % 4 === 0) loadNotes();
  schedule();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.user) tick(); else clearTimeout(timer); });
addEventListener("hashchange", () => { const id = location.hash.slice(1); if (state.user && id && id !== state.selected) select(id); });

start();
