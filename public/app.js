// BidDesk estimating desk. Plain JS, no build step.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const usd2 = (n) => (n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const clock = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

const WORKING = ["received", "intake", "estimating", "reviewing", "analyzed"];
const DONE = ["approved", "declined", "info_requested"];
const CALL = { pursue: "Pursue", decline: "Decline", needs_info: "Needs info" };
const WIRE = { pursue: "var(--go)", decline: "var(--no)", needs_info: "var(--ask)", approved: "var(--go)", declined: "var(--no)", info_requested: "var(--ask)" };
const TAGCLASS = { pursue: "go", decline: "no", needs_info: "ask", approved: "go", declined: "no", info_requested: "ask" };
const HUMAN = { approved: "Approved to bid", declined: "Declined", info_requested: "Questions sent to GC" };
const STAGE = { received: "Queued", intake: "Reading the invite", estimating: "Pricing the scope", reviewing: "Checking the rules", analyzed: "Routing" };

const state = { list: [], view: "review", selected: null, bid: null, section: "overview", showAllChecks: false };

async function api(path, opts) {
  const r = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = "none"), 2600); }

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
  $("#views").innerHTML = views.map(([k, l]) => `<button aria-pressed="${state.view === k}" data-v="${k}">${l}<span>${counts[k]}</span></button>`).join("");
  $("#views").querySelectorAll("button").forEach((b) => (b.onclick = () => { state.view = b.dataset.v; renderQueue(); }));

  const review = state.list.filter((b) => bucket(b) === "review");
  const overdue = review.filter((b) => b.overdue || (b.reviewDueAt && new Date(b.reviewDueAt) < new Date())).length;
  const pursued = state.list.filter((b) => b.humanDecision === "approved" || (!b.humanDecision && b.decision === "pursue")).reduce((s, b) => s + (b.total || 0), 0);
  $("#tally").innerHTML = `<div><b>${review.length}</b>to review</div><div class="${overdue ? "hot" : ""}"><b>${overdue}</b>overdue</div><div><b>${usd(pursued)}</b>in play</div>`;
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
    if (WORKING.includes(b.status)) tags.push(`<span class="tag live">${esc(STAGE[b.status])}</span>`);
    if (b.status === "error") tags.push(`<span class="tag no">Stopped</span>`);
    if (b.humanDecision) tags.push(`<span class="tag ${TAGCLASS[b.humanDecision]}">${HUMAN[b.humanDecision]}</span>`);
    else if (b.decision) tags.push(`<span class="tag ${TAGCLASS[b.decision]}">${CALL[b.decision]}</span>`);
    if (b.priority === "P1" && !b.humanDecision) tags.push(`<span class="tag p1">Urgent</span>`);
    if (b.overdue && !b.humanDecision) tags.push(`<span class="tag late">Overdue</span>`);
    const wire = WIRE[b.humanDecision || b.decision] || (WORKING.includes(b.status) ? "var(--copper)" : "var(--line-2)");
    return `<button class="item" style="--wire:${wire}" aria-current="${state.selected === b.id}" data-id="${esc(b.id)}">
      <div class="t">${esc(b.project || b.subject)}</div>
      <div class="m">${tags.join("")}<span>${esc(b.gc || b.from)}</span>${b.total ? `<span class="amt">${usd(b.total)}</span>` : ""}</div>
    </button>`;
  }).join("");
  $("#list").querySelectorAll(".item").forEach((el) => (el.onclick = () => select(el.dataset.id)));
}
async function loadQueue() {
  try { state.list = await api("/api/bids"); } catch (e) { $("#list").innerHTML = `<div class="empty"><b>Couldn't load bids</b>${esc(e.message)}</div>`; return; }
  const cur = state.list.find((b) => b.id === state.selected);
  if (cur) { const bk = bucket(cur); if (state.selBucket && bk !== state.selBucket) state.view = bk; state.selBucket = bk; }
  renderQueue();
}
async function select(id, opts = {}) {
  state.selected = id;
  state.showAllChecks = false;
  state.ticked = {};
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
  try { state.bid = await api(`/api/bids/${state.selected}`); } catch (e) { $("#main").innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  renderBid();
}

/* ---------------- plain-English agent steps ---------------- */
function describe(tool, input, output) {
  const o = output || {}, i = input || {};
  switch (tool) {
    case "lookup_travel_distance": return o.found ? `Measured the drive: ${i.town}, ${i.state} is ${o.miles_from_hopkinton} miles from Hopkinton.` : `Couldn't find ${i.town}, ${i.state} in the distance table, so distance is unknown.`;
    case "check_crew_capacity": return o.openPct != null ? `Checked the crew schedule for ${i.month}: ${o.openPct}% of capacity open. ${o.note || ""}` : `No crew schedule for ${i.month} yet.`;
    case "check_gc_history": return o.status === "new" ? `Looked up ${i.gc_name}: no history with CEC.` : `Looked up ${i.gc_name}: ${o.status} relationship, ${o.wins} of ${o.jobs} bids won. ${o.note || ""}`;
    case "search_price_book": { const hits = Array.isArray(o) ? o : []; return hits.length ? `Searched the price book for “${i.query}” and found ${hits[0].description} (${hits[0].code})${hits.length > 1 ? ` plus ${hits.length - 1} more` : ""}.` : `Searched the price book for “${i.query}”: no match.`; }
    case "get_bid_criteria": return `Loaded CEC’s ${Array.isArray(o) ? o.length : ""} go / no-go rules.`;
    case "find_similar_past_jobs": return Array.isArray(o) ? `Pulled ${o.length} past ${String(i.project_type).replace("_", " ")} jobs to compare against.` : `No past ${String(i.project_type).replace("_", " ")} jobs to compare against.`;
    case "count_business_days": return o.business_days_until_due != null ? `Counted ${o.business_days_until_due} business days until the ${o.due} bid deadline.` : `Couldn't read the due date.`;
    default: return `Used ${tool}.`;
  }
}
function finalLine(tool, input) {
  const i = input || {};
  const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  if (tool === "submit_intake") return `Handed off ${n((i.scope_items || []).length, "scope item")} and ${n((i.missing_info || []).length, "open question")} to the Estimator.`;
  if (tool === "submit_estimate") return `Handed off ${n((i.lines || []).length, "priced line")} and ${n((i.allowances || []).length, "allowance")} to the Reviewer. Confidence: ${i.confidence}.`;
  if (tool === "submit_recommendation") return `Recommended: ${CALL[i.decision] || i.decision}, fit ${i.fit_score}/100.`;
  return `Submitted ${tool}.`;
}
function lanes(trace) {
  const order = ["Intake Agent", "Estimator Agent", "Reviewer Agent", "System"];
  const pending = {}, out = {};
  for (const t of trace) {
    const lane = (out[t.agent] ||= []);
    if (t.kind === "tool_call") { (pending[t.tool] ||= []).push(t.input); }
    else if (t.kind === "tool_result") { const inp = (pending[t.tool] || []).shift(); lane.push({ at: t.at, cls: "", text: describe(t.tool, inp, t.output), raw: t.output }); }
    else if (t.kind === "final") lane.push({ at: t.at, cls: "final", text: finalLine(t.tool, t.input), raw: t.input });
    else if (t.kind === "error") lane.push({ at: t.at, cls: "bad", text: t.text.startsWith("Rejected") ? `Sent back by the server: ${t.text.replace(/^Rejected:\s*/, "")}` : t.text });
    else if (t.kind === "thinking") lane.push({ at: t.at, cls: "thought", text: t.text });
  }
  return order.filter((a) => out[a]).map((a) => [a, out[a]]);
}
const ROLE = { "Intake Agent": "Reads the invite and gathers context", "Estimator Agent": "Prices the scope from the price book", "Reviewer Agent": "Checks CEC’s rules and makes the call", System: "Pipeline" };

/* ---------------- screens ---------------- */
function renderWelcome() {
  $("#main").innerHTML = `<div class="welcome">
    <h1>Bid invitations, read and priced before you open them.</h1>
    <p>When a general contractor invites CEC to bid, three agents take the first pass. One reads the invite, one prices it from the price book, and one checks it against CEC’s bid rules. BidDesk then routes it to the right estimator with a deadline. You make the call.</p>
    <div class="acts"><a class="btn dark" href="/portal.html" target="_blank" rel="noopener">Open the GC bid portal</a><button class="btn" onclick="openLog()">Log a bid email</button></div>
  </div>`;
}

function node(label, sub, cls) { return `<div class="node ${cls}"><div class="pt"></div><b>${label}</b><small>${esc(sub)}</small></div>`; }
function oneLine(b) {
  const i = b.intake || {}, e = b.estimate, r = b.review, rt = b.routing;
  const st = b.status;
  const idx = { received: 0, intake: 0, estimating: 1, reviewing: 2, analyzed: 3, awaiting_review: 4 }[st] ?? (DONE.includes(st) ? 5 : 0);
  const errAt = st === "error" ? [!!b.intake, !!b.estimate, !!b.review].indexOf(false) : -1;
  const cls = (k) => (errAt === k ? "err" : st === "error" ? (k < errAt ? "done" : "") : k < idx ? "done" : k === idx ? "now" : "");
  const fill = st === "error" ? Math.max(0, errAt) * 25 : Math.min(idx, 4) * 25;
  return `<div class="oneline" aria-label="Pipeline progress"><div class="row">
    <div class="wire"><i style="--fill:${fill}%"></i></div>
    ${node("Intake", i.project_name ? `${(i.scope_items || []).length} scope items found` : "Reading the invite", cls(0))}
    ${node("Estimate", e ? usd(e.totals.total) + " budget" : "Pricing the scope", cls(1))}
    ${node("Review", r ? `${CALL[r.decision]}, fit ${r.fit_score}` : "Checking the rules", cls(2))}
    ${node("Route", rt ? `${rt.assignee}` : "Priority and deadline", cls(3))}
    ${node("You", b.decision ? HUMAN[b.decision.action] : rt ? `Due ${when(rt.reviewDueAt)}` : "Final decision", cls(4))}
  </div></div>`;
}

function renderBid() {
  const b = state.bid, i = b.intake || {}, e = b.estimate, r = b.review, rt = b.routing;
  const working = WORKING.includes(b.status);
  const where = [i.location_town, i.location_state].filter(Boolean).join(", ");
  const tags = [];
  if (rt?.priority === "P1" && !b.decision) tags.push(`<span class="tag p1">Urgent</span>`);
  if (rt?.overdue && !b.decision) tags.push(`<span class="tag late">Overdue</span>`);
  if (working) tags.push(`<span class="tag live">${esc(STAGE[b.status])}</span>`);
  if ((b.source.channel || "email") === "portal") tags.push(`<span class="tag">From bid portal</span>`);

  let html = `<div class="head"><div>
      <h1>${esc(i.project_name || b.source.subject)}</h1>
      <div class="sub">${[i.gc_name || b.source.from, where, i.bid_due_date ? `Bids due ${i.bid_due_date}` : ""].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
    </div><div style="display:flex;gap:6px;flex-wrap:wrap">${tags.join("")}</div></div>
    ${oneLine(b)}
    ${b.error ? `<div class="err"><b>The pipeline stopped.</b> ${esc(b.error)}</div>` : ""}`;

  if (r && e) {
    const wire = WIRE[r.decision];
    html += `<section class="verdict" style="--wire:${wire}" aria-label="Recommendation">
      <div class="say">
        <div class="call"><strong>${CALL[r.decision]}</strong><div class="fit"><div class="meter" aria-hidden="true"><i style="width:${r.fit_score}%"></i></div>Fit ${r.fit_score} of 100</div></div>
        <p class="lead">${esc(r.headline)}</p>
        <p class="why">${esc(r.rationale)}</p>
      </div>
      <dl class="facts">
        <div class="big"><span>Budget estimate · ${esc(e.confidence)} confidence</span><b>${usd(e.totals.total)}</b></div>
        <dt>Distance</dt><dd>${i.travel_miles != null ? `${i.travel_miles} mi from Hopkinton` : "Unknown"}</dd>
        <dt>Crew open</dt><dd>${i.crew_capacity_open_pct != null ? `${i.crew_capacity_open_pct}% that month` : "Unknown"}</dd>
        <dt>GC record</dt><dd>${esc(i.gc_status || "—")}</dd>
        <dt>Labor</dt><dd>${Math.round(e.totals.labor_hours).toLocaleString()} hours</dd>
      </dl>
    </section>`;
  }

  if (b.decision) {
    html += `<section class="decide decided" style="--wire:${WIRE[b.decision.action]}"><h2>${HUMAN[b.decision.action]}</h2>
      <div class="hint">${esc(b.decision.by)} decided ${when(b.decision.at)}${b.decision.note ? `: “${esc(b.decision.note)}”` : ""}</div>
      <div class="row"><button class="btn" onclick="go('emails')">See the reply to the GC</button><button class="btn" onclick="reopen()">Change decision</button></div></section>`;
  } else if (b.status === "awaiting_review" && r) {
    const flags = r.human_review_flags || [];
    const shown = state.showAllChecks ? flags : flags.slice(0, 4);
    html += `<section class="decide" aria-label="Your decision"><h2>Your call</h2>
      <div class="hint">Check these before deciding. Nothing reaches the GC until you choose.${rt ? ` Assigned to ${esc(rt.assignee)}, due ${when(rt.reviewDueAt)}.` : ""}</div>
      <ul class="checks">${shown.map((f, k) => `<li><label><input type="checkbox" ${state.ticked?.[k] ? "checked" : ""} onchange="(state.ticked ||= {})[${k}]=this.checked"> ${esc(f)}</label></li>`).join("")}</ul>
      ${flags.length > 4 ? `<button class="more" onclick="state.showAllChecks=!state.showAllChecks;renderBid()">${state.showAllChecks ? "Show fewer" : `Show all ${flags.length} checks`}</button>` : ""}
      <div class="row"><textarea id="dNote" aria-label="Note for the record" placeholder="Note for the record (optional)"></textarea>
        <button class="btn go" onclick="decide('approved')">Approve bid</button>
        <button class="btn ask" onclick="decide('info_requested')">Ask GC questions</button>
        <button class="btn no" onclick="decide('declined')">Decline</button></div></section>`;
  }

  const secs = [["overview", "Rules & risks"], ["estimate", "Estimate"], ["scope", "Scope"], ["agents", "Agent activity"], ["emails", "Emails"]];
  html += `<div class="switch" role="tablist">${secs.map(([k, l]) => `<button role="tab" aria-selected="${state.section === k}" onclick="go('${k}')">${l}</button>`).join("")}</div>
    <div id="section">${renderSection(b)}</div>
    <p class="foot">Price book, bid rules, crew schedule and GC history are sample data for this demo. ${b.model ? `Agents run on ${esc(b.model)} through Netlify AI Gateway.` : ""}</p>`;
  $("#main").innerHTML = html;
}

function wait(b, who) { return `<div class="panel empty">${b.status === "error" ? "The pipeline stopped before this step." : `<b>Working on it</b>The ${who} hasn’t finished yet. Watch it live under Agent activity.`}</div>`; }

function renderSection(b) {
  const i = b.intake, e = b.estimate, r = b.review;
  switch (state.section) {
    case "overview":
      if (!r) return wait(b, "Reviewer agent");
      return `<div class="grid2"><div class="panel"><h3>CEC’s bid rules</h3>${r.criteria_checks.map((c) => `<div class="rule"><span class="res ${c.result}">${c.result}</span><div><b>${esc(c.criterion.replace(/_/g, " "))}</b><span>${esc(c.note)}</span></div></div>`).join("")}</div>
        <div><div class="panel"><h3>Risks</h3>${r.risks.length ? `<ul class="plain">${r.risks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p>None flagged.</p>"}</div>
        <div class="panel"><h3>Questions for the GC</h3>${r.questions_for_gc.length ? `<ul class="plain">${r.questions_for_gc.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p>None.</p>"}</div></div></div>`;
    case "estimate":
      if (!e) return wait(b, "Estimator agent");
      return `<div class="panel" style="overflow-x:auto"><h3>Priced from the CEC price book. Labor at ${usd(e.totals.labor_rate)} per hour.</h3>
        <table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Material</th><th class="n">Labor hrs</th><th class="n">Line total</th></tr></thead><tbody>
        ${e.lines.map((l) => `<tr><td>${esc(l.description)} <span class="code">${esc(l.item_code)}</span>${l.note ? `<span class="note">${esc(l.note)}</span>` : ""}</td><td class="n">${l.quantity} ${esc(l.unit)}</td><td class="n">${usd(l.material)}</td><td class="n">${l.labor_hours}</td><td class="n">${usd(l.line_total)}</td></tr>`).join("")}
        ${e.allowances.map((a) => `<tr><td>Allowance: ${esc(a.description)}<span class="note">${esc(a.reason)}</span></td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n">${usd(a.amount)}</td></tr>`).join("")}
        <tr class="sum"><td colspan="4">Direct cost</td><td class="n">${usd2(e.totals.direct)}</td></tr>
        <tr class="sum"><td colspan="4">Overhead ${Math.round(e.totals.overhead_pct * 100)}%</td><td class="n">${usd2(e.totals.overhead)}</td></tr>
        <tr class="sum"><td colspan="4">Profit ${Math.round(e.totals.profit_pct * 100)}%</td><td class="n">${usd2(e.totals.profit)}</td></tr>
        <tr class="total"><td colspan="3">Budget estimate</td><td class="n">${e.totals.labor_hours}</td><td class="n">${usd2(e.totals.total)}</td></tr>
        </tbody></table></div>
        <div class="grid2" style="margin-top:14px"><div class="panel"><h3>Assumptions</h3><ul class="plain">${e.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>
        <div class="panel"><h3>Confidence: ${esc(e.confidence)}</h3><p style="margin:0;color:var(--ink-2)">${esc(e.confidence_reason)}</p><p class="quote" style="margin-top:12px">The agent picks items and quantities. Every dollar is calculated by code, not the AI.</p></div></div>`;
    case "scope":
      if (!i) return wait(b, "Intake agent");
      return `<div class="panel" style="overflow-x:auto"><h3>${esc(i.scope_summary)}</h3>
        <table><thead><tr><th style="width:28px"></th><th>Work item</th><th class="n">Qty</th><th>Where it says so in the invite</th></tr></thead><tbody>
        ${(i.scope_items || []).map((s) => `<tr><td>${s.verified ? '<span class="ok" title="Quote found in the invite">✓</span>' : '<span class="bad" title="Quote not found in the invite">!</span>'}</td><td>${esc(s.description)}</td><td class="n">${s.quantity ?? "?"} ${esc(s.unit || "")}</td><td class="quote">“${esc(s.source_quote)}”</td></tr>`).join("")}
        </tbody></table>
        <p class="quote" style="margin-top:12px">✓ means the server found that exact quote in the original invite, so the item wasn’t made up.</p></div>
        ${i.missing_info?.length ? `<div class="panel"><h3>Missing from the invite</h3><ul class="plain">${i.missing_info.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}`;
    case "agents": {
      const ls = lanes(b.trace);
      const auto = b.automation.length ? `<div class="panel lane"><h3>Routing automation <small>Rules, not AI. Runs when the agents finish.</small></h3><ol>${b.automation.map((a) => `<li class="${/error/i.test(a.step) ? "bad" : ""}"><time>${clock(a.at)}</time><b>${esc(a.step.replace(/^\d+\.\s*/, ""))}.</b> ${esc(a.detail)}</li>`).join("")}</ol></div>` : "";
      if (!ls.length && !auto) return wait(b, "Intake agent");
      return `<div class="log">${ls.map(([agent, steps]) => `<div class="panel lane"><h3>${esc(agent)} <small>${esc(ROLE[agent] || "")}</small></h3><ol>${steps.map((s) => `<li class="${s.cls}"><time>${clock(s.at)}</time>${esc(s.text)}${s.raw ? `<details class="raw"><summary>Raw data</summary><pre>${esc(JSON.stringify(s.raw, null, 2))}</pre></details>` : ""}</li>`).join("")}</ol></div>`).join("")}${auto}</div>`;
    }
    case "emails":
      return `${r ? `<div class="panel"><h3>Draft reply to ${esc(i?.gc_contact || i?.gc_name || "the GC")}</h3><div class="mailhead">Not sent. Copy it into your email once you’ve decided.</div><div class="mail">${esc(r.gc_reply_draft)}</div><div style="margin-top:12px"><button class="btn" onclick="copyReply()">Copy reply</button></div></div>` : ""}
        <div class="panel"><h3>Original invitation</h3><div class="mailhead">From ${esc(b.source.from)} · ${esc(b.source.subject)}</div><div class="mail">${esc(b.source.body)}</div></div>`;
  }
  return "";
}

window.go = (k) => { state.section = k; renderBid(); };
window.copyReply = async () => { try { await navigator.clipboard.writeText(state.bid.review.gc_reply_draft); toast("Reply copied"); } catch { toast("Couldn’t copy. Select the text instead."); } };
window.decide = async (action) => {
  const note = $("#dNote")?.value || "";
  try {
    state.bid = await api(`/api/bids/${state.selected}/decision`, { method: "POST", body: JSON.stringify({ action, note, by: "Estimator" }) });
    renderBid(); await loadQueue(); toast(HUMAN[action]);
  } catch (e) { toast(e.message); }
};
window.reopen = () => { state.bid.decision = null; state.bid.status = "awaiting_review"; renderBid(); };

/* ---------------- log an email ---------------- */
const dlg = $("#logDialog");
window.openLog = () => { $("#fErr").hidden = true; dlg.showModal(); };
$("#logBtn").onclick = openLog;
$("#examples").insertAdjacentHTML("beforeend", (window.BIDDESK_SAMPLES || []).map((s, k) => `<button type="button" data-k="${k}">${esc(s.label)}</button>`).join(""));
$("#examples").querySelectorAll("button").forEach((b) => (b.onclick = () => { const s = BIDDESK_SAMPLES[b.dataset.k]; $("#fFrom").value = s.from; $("#fSubj").value = s.subject; $("#fBody").value = s.body; }));
$("#logForm").addEventListener("submit", async (ev) => {
  if (ev.submitter?.value === "cancel") return;
  ev.preventDefault();
  const btn = $("#logSubmit"); btn.disabled = true; btn.textContent = "Starting…";
  try {
    const { id } = await api("/api/submit", { method: "POST", body: JSON.stringify({ channel: "email", from: $("#fFrom").value, subject: $("#fSubj").value, body: $("#fBody").value }) });
    dlg.close(); ["#fFrom", "#fSubj", "#fBody"].forEach((s) => ($(s).value = ""));
    await loadQueue(); state.section = "agents"; await select(id, { keepSection: true }); toast("Agents started");
  } catch (e) { $("#fErr").textContent = e.message; $("#fErr").hidden = false; }
  finally { btn.disabled = false; btn.textContent = "Start analysis"; }
});

/* ---------------- notifications ---------------- */
async function loadNotes() {
  try {
    const list = await api("/api/notifications");
    const unread = list.filter((n) => !n.read).length;
    $("#bellDot").hidden = !unread; $("#bellDot").textContent = unread;
    $("#notes").innerHTML = list.length ? list.map((n) => `<button class="note ${n.read ? "" : "unread"}" data-id="${esc(n.bidId)}"><b>${esc(n.title.replace(/^P\d · /, ""))}</b><span>${esc(n.body)}</span><time>${when(n.at)}</time></button>`).join("") : `<div class="empty"><b>No notifications</b>You’ll hear here when a bid is routed to you.</div>`;
    $("#notes").querySelectorAll(".note").forEach((el) => (el.onclick = () => { $("#drawer").classList.remove("open"); select(el.dataset.id); }));
  } catch {}
}
$("#bellBtn").onclick = async () => { $("#drawer").classList.add("open"); await api("/api/notifications", { method: "POST" }).catch(() => {}); setTimeout(loadNotes, 400); };
$("#closeDrawer").onclick = () => $("#drawer").classList.remove("open");
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#drawer").classList.remove("open"); });

/* ---------------- live updates ---------------- */
async function tick() {
  await loadQueue();
  const b = state.bid;
  if (state.selected && b && (WORKING.includes(b.status) || (b.status === "awaiting_review" && !b.automation.length))) {
    const typing = document.activeElement?.id === "dNote";
    const y = scrollY;
    if (!typing) { await loadBid(); scrollTo(0, y); }
  }
  loadNotes();
}
(async () => {
  await loadQueue();
  const hash = location.hash.slice(1);
  if (hash) await select(hash);
  else if (state.list.length) { const first = state.list.find((b) => bucket(b) === "review") || state.list[0]; await select(first.id); }
  else renderWelcome();
  loadNotes();
  setInterval(tick, 2500);
})();
addEventListener("hashchange", () => { const id = location.hash.slice(1); if (id && id !== state.selected) select(id); });
