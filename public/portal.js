// GC bid portal. Public page: no sign-in. Kept in its own file so the site can block inline script.
const $ = (s) => document.querySelector(s);
const example = {
  company: "Metrowest Builders Group", contact: "Dana Whitfield", email: "dwhitfield@metrowestbuilders.example",
  project: "Natick Pediatrics clinic fit-out", address: "209 W Central St", town: "Natick", state: "MA",
  due: (() => { const d = new Date(); d.setDate(d.getDate() + 16); return d.toISOString().slice(0, 10); })(),
  start: "2027-02",
  scope: "Approx 7,500 sq ft first-floor pediatric clinic in an existing office building.\n- (90) 2x4 LED troffers and (36) 6\" LED downlights\n- (10) exit/emergency combo units\n- (110) 20A duplex receptacles and (24) GFCI receptacles\n- (40) single-pole switches and (22) occupancy sensor switches\n- (1) new 225A 42-circuit panelboard fed from the existing switchboard\n- (48) Cat6 data drops\n- Fire alarm: (30) devices tied into the existing building panel\n- (3) RTU connections\n- Demo of (60) existing light fixtures",
  notes: "Drawings E-001 to E-301 available on request. No prevailing wage.",
};
$("#example").addEventListener("click", () => { for (const [k, v] of Object.entries(example)) $("#" + k).value = v; });
$("#another").addEventListener("click", () => { $("#form").reset(); $("#done").hidden = true; $("#form").hidden = false; $("#intro").hidden = false; });
$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const missing = ["company", "project", "town", "scope"].filter((k) => !String(data[k] || "").trim());
  if (missing.length) { $("#err").textContent = "Fill in the general contractor, project name, town and electrical scope."; $("#err").hidden = false; $("#" + missing[0]).focus(); return; }
  const btn = $("#send"); btn.disabled = true; btn.textContent = "Sending…"; $("#err").hidden = true;
  try {
    const r = await fetch("/api/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "portal", ...data }) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || `Couldn’t send (${r.status}). Try again in a minute.`);
    $("#ref").textContent = String(out.reference || "");
    $("#openDesk").href = typeof out.id === "string" && /^bid-[a-z0-9-]+$/.test(out.id) ? "/#" + out.id : "/";
    $("#form").hidden = true; $("#intro").hidden = true; $("#done").hidden = false; scrollTo(0, 0);
  } catch (err) { $("#err").textContent = err.message; $("#err").hidden = false; }
  finally { btn.disabled = false; btn.textContent = "Send bid invitation"; }
});
