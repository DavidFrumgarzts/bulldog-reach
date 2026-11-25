// Boot Outreach workspace: discovery → shortlist → application workspace → reviewed submission, plus contacts & outreach.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const W = { session: null, auth: false, state: null, opps: [], apps: [], contacts: [], outreach: [], answers: [], searches: [], tab: "discover" };
const STAGE_LABEL = { discovered: "Discovered", researching: "Researching", shortlisted: "Shortlisted", preparing: "Preparing", ready_for_review: "Ready for review", submitted: "Submitted", assessment: "Assessment", interview: "Interview", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn", archived: "Archived" };
const CLOSED = ["rejected", "withdrawn", "archived"];
const ELIG_FIELDS = [["visa_status", "Visa status (e.g. F-1)"], ["citizenship", "Citizenship"], ["work_authorization", "U.S. work authorization"], ["cpt", "CPT (e.g. eligible from Summer 2027 per DSO)"], ["opt", "OPT"], ["school", "School"], ["academic_term", "Academic term / availability"], ["restrictions", "Other restrictions you choose to share"]];
const PRIOS = [["startup", "Startup learning"], ["product_gtm", "Product / GTM exposure"], ["robotics", "Robotics relevance"], ["brand", "Brand / credibility"], ["compensation", "Compensation"], ["location", "Location"]];

// ---------- plumbing ----------
function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), ms); }
async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (W.session?.access_token) headers.Authorization = "Bearer " + W.session.access_token;
  const r = await fetch("/api/boot" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = "/app"; throw new Error("Sign in first"); }
  if (!r.ok) throw Object.assign(new Error(d.error || "Something broke"), { status: r.status });
  return d;
}
async function download(path, name) {
  const headers = W.session?.access_token ? { Authorization: "Bearer " + W.session.access_token } : {};
  const r = await fetch(path, { headers });
  if (!r.ok) return toast("Download failed");
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const ago = (iso) => { if (!iso) return "never"; const d = (Date.now() - new Date(iso)) / 864e5; return d < 1 ? "today" : `${Math.floor(d)}d ago`; };
const splitList = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const scoreCls = (n) => (n == null ? "" : n >= 65 ? "g" : n >= 35 ? "y" : "r");
const eligCls = (s) => ({ possible_conflict: "r", check: "y", not_stated: "", asks_authorization: "y", posting_mentions_support: "g", requirement_noted: "y" }[s] || "");
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");

async function boot() {
  const cfg = await fetch("/api/config").then((r) => r.json());
  W.auth = cfg.auth;
  if (cfg.auth) {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true } });
    W.session = (await sb.auth.getSession()).data.session;
    if (!W.session) { location.href = "/app"; return; }
    $("#who").textContent = W.session.user.email;
  } else $("#who").textContent = cfg.demo ? "local mode · no sign-in" : "local mode";
  $$(".wstabs button").forEach((b) => (b.onclick = () => show(b.dataset.tab)));
  await loadState();
  paintTier();
  show(location.hash.slice(1) || (!W.state.claims.length ? "profile" : W.state.integrations.ai ? "ask" : "discover"));
}
async function loadState() {
  const [st, s, o, a] = await Promise.all([api("/state"), api("/searches"), api("/opps?state=all"), api("/apps")]);
  W.state = st; W.searches = s.searches; W.opps = o.opportunities; W.apps = a.apps;
}
function show(tab) {
  W.tab = tab; history.replaceState(null, "", "#" + tab);
  $$(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + tab));
  $$(".wstabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  ({ ask: loadAsk, discover: paintDiscover, pipeline: paintPipeline, contacts: loadContacts, answers: loadAnswers, profile: paintProfile, data: paintData })[tab]?.();
}

// ---------- Basic / Pro ----------
function paintTier() {
  const i = W.state.integrations, t = W.state.profile.tier === "pro" ? "pro" : "basic";
  if (!i.ai) { $("#tier").innerHTML = ""; return; }
  $("#tier").innerHTML = [["basic", "Basic", i.ai_models.basic], ["pro", "Pro", i.ai_models.pro]].map(([k, l, m]) => `<button class="${t === k ? "on" : ""}" title="${esc(l)}: drafts and chat replies use ${esc(m)}. Web search always uses ${esc(i.ai_models.search)}." onclick="setTier('${k}')">${l}</button>`).join("");
}
async function setTier(t) {
  try { const { profile } = await api("/tier", { method: "PUT", body: { tier: t } }); W.state.profile = profile; paintTier(); toast(t === "pro" ? `Pro: writing with ${W.state.integrations.ai_models.pro}` : `Basic: writing with ${W.state.integrations.ai_models.basic}`); }
  catch (e) { toast(e.message); }
}

// ---------- Ask Bulldog ----------
// Light markdown: escape everything, then allow **bold**, [text](url), bare URLs, "- " bullets and paragraphs.
function md(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u.length > 60 ? u.slice(0, 57) + "…" : u}</a>`);
  const out = []; let list = null;
  for (const line of String(text || "").split("\n")) {
    const b = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (b) { (list ||= []).push(`<li>${inline(b[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
    if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ""))}</p>`);
  }
  if (list) out.push(`<ul>${list.join("")}</ul>`);
  return out.join("");
}
const ASK_STARTERS = ["Find AI or robotics internships in NYC or the Bay Area that fit me", "What fellowships or programs could fund a startup-focused summer?", "Which roles in my pipeline close first, and what's blocking each?", "Who should I reach out to at Figure about operations internships?"];
async function loadAsk() {
  if (!W.state.integrations.ai) {
    $("#ask_threads").innerHTML = "";
    $("#ask_thread").innerHTML = `<div class="askhero"><h2>Ask Bulldog is off</h2><p>It needs an Anthropic API key (paid per use). Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart. Everything else in the Workspace works without it.</p></div>`;
    $("#ask_in").disabled = $("#ask_send").disabled = true; return;
  }
  const { chats } = await api("/chats");
  W.chats = chats;
  paintAskList();
  if (W.askThread) openThread(W.askThread); else newAsk();
}
function paintAskList() {
  $("#ask_threads").innerHTML = (W.chats || []).map((c) => `<button class="th ${c.id === W.askThread ? "on" : ""}" onclick="openThread('${c.id}')"><span>${esc(c.title)}</span><i class="small muted" onclick="event.stopPropagation();delThread('${c.id}')">×</i></button>`).join("");
}
function newAsk() {
  W.askThread = null; paintAskList();
  const i = W.state.integrations;
  $("#ask_thread").innerHTML = `<div class="askhero"><h2>Ask Bulldog</h2><p>Searches the official job boards and the live web, checks your pipeline and profile, and can save what it finds. It won't send anything or apply for you.</p><div class="starter">${ASK_STARTERS.map((s) => `<button class="btn sm" onclick="$('#ask_in').value=this.textContent;$('#ask_in').focus()">${esc(s)}</button>`).join("")}</div></div>`;
  $("#ask_note").textContent = `Replies: ${W.state.profile.tier === "pro" ? "Pro · " + i.ai_models.pro : "Basic · " + i.ai_models.basic}. Web searches: ${i.ai_models.search}. Paid per use, with daily limits.`;
}
function renderMsg(m) {
  if (m.role === "user") return `<div class="amsg u">${esc(m.text)}</div>`;
  const acts = (m.activity || []).map((a) => `<span class="pill ${a.type === "save" || a.type === "contact" ? "g" : "b"}">${esc(a.text)}</span>`).join("");
  return `<div class="amsg a">${acts ? `<div class="acts">${acts}</div>` : ""}${md(m.text)}<div class="meta">${esc(m.model || "")}</div></div>`;
}
async function openThread(id) {
  W.askThread = id; paintAskList();
  const { chat } = await api(`/chats/${id}`);
  $("#ask_thread").innerHTML = chat.display.map(renderMsg).join("");
  window.scrollTo(0, document.body.scrollHeight);
}
async function delThread(id) { if (!confirm("Delete this chat?")) return; await api(`/chats/${id}`, { method: "DELETE" }); if (W.askThread === id) W.askThread = null; loadAsk(); }
async function sendAskMsg(e) {
  e?.preventDefault();
  const text = $("#ask_in").value.trim(); if (!text) return;
  $("#ask_in").value = ""; $("#ask_send").disabled = true;
  $(".askhero")?.remove();
  $("#ask_thread").insertAdjacentHTML("beforeend", renderMsg({ role: "user", text }) + `<div class="amsg a" id="ask_wait"><p class="muted">Thinking… (searches can take up to a minute)</p></div>`);
  window.scrollTo(0, document.body.scrollHeight);
  try {
    const r = await api("/chat", { method: "POST", body: { thread_id: W.askThread, message: text } });
    $("#ask_wait").outerHTML = renderMsg(r.reply);
    if (!W.askThread) { W.askThread = r.thread_id; W.chats = (await api("/chats")).chats; paintAskList(); }
    if ((r.reply.activity || []).some((a) => a.type === "save")) { W.apps = (await api("/apps")).apps; W.opps = (await api("/opps?state=all")).opportunities; }
  } catch (err) { $("#ask_wait").innerHTML = `<p style="color:#ff9d90">${esc(err.message)}</p>`; }
  $("#ask_send").disabled = false; $("#ask_in").focus();
  window.scrollTo(0, document.body.scrollHeight);
}
document.addEventListener("keydown", (e) => { if (e.target.id === "ask_in" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAskMsg(); } });

// ---------- discover ----------
function filtersFromUI() {
  return {
    name: $("#d_query").value.trim() || "Search", query: $("#d_query").value.trim(),
    locations: splitList($("#d_loc").value), keywords: splitList($("#d_kw").value), level: $("#d_level").value,
    term: $("#d_term").value.trim(), include_remote: $("#d_remote").checked, match_families: $("#d_fam").checked,
  };
}
function setFilters(f) {
  $("#d_loc").value = (f.locations || []).join(", "); $("#d_kw").value = (f.keywords || []).join(", ");
  $("#d_level").value = f.level || "internship"; $("#d_term").value = f.term || ""; $("#d_remote").checked = f.include_remote !== false; $("#d_fam").checked = !!f.match_families;
  if (f.query !== undefined) $("#d_query").value = f.query || "";
}
async function parseQuery() {
  const q = $("#d_query").value.trim(); if (!q) return toast("Type what you're looking for first");
  const { parsed } = await api("/searches/parse", { method: "POST", body: { query: q } });
  setFilters({ ...parsed, query: q, match_families: parsed.role_families.length > 0 });
  W.parsedFamilies = parsed.role_families;
  toast(parsed.role_families.length ? `Role families: ${parsed.role_families.map((f) => W.state.families[f]).join(", ")}` : "Filters filled");
}
async function runSearch() {
  const btn = $("#d_run"); btn.disabled = true; btn.textContent = "Searching job boards…";
  try {
    const f = filtersFromUI();
    if (W.parsedFamilies?.length) f.role_families = W.parsedFamilies;
    const r = await api("/search/run", { method: "POST", body: f });
    W.lastSources = r.sources;
    const o = await api("/opps?state=all"); W.opps = o.opportunities;
    $("#d_view").value = "new";
    W.lastRun = new Set(r.opportunities.map((x) => x.id));
    $("#d_meta").textContent = `${r.opportunities.length} roles from ${r.sources.length} official boards · checked ${new Date().toLocaleTimeString()} · ranked by ${r.method === "meaning" ? "meaning (local model)" : r.method}${r.filtered_out ? ` · ${r.filtered_out} hidden as far from your interests` : ""}. Dismissed roles stay hidden.`;
    paintDiscover();
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.textContent = "Search official job boards";
}
async function saveSearch() {
  const f = filtersFromUI(); if (W.parsedFamilies?.length) f.role_families = W.parsedFamilies;
  const name = prompt("Name this search", f.name); if (!name) return;
  await api("/searches", { method: "POST", body: { ...f, name } });
  W.searches = (await api("/searches")).searches; paintSaved(); toast("Search saved");
}
function paintSaved() { $("#d_saved").innerHTML = `<option value="">Saved searches…</option>` + W.searches.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(""); }
function loadSaved(id) { const s = W.searches.find((x) => x.id === id); if (!s) return; setFilters(s); W.parsedFamilies = s.role_families; toast(`Loaded "${s.name}". Press Search to refresh it.`); }

function oppCard(o) {
  const f = o.fit || {}, ev = o.evidence || {};
  const pills = [
    `<span class="pill ${scoreCls(f.interest?.score)}" title="${esc((f.interest?.reasons || []).join(" · "))}">Interest ${f.interest?.score ?? "–"}</span>`,
    `<span class="pill ${scoreCls(f.experience?.score)}" title="${esc(f.experience?.missing?.join(" ") || "")}">Experience ${f.experience?.score ?? "?"}</span>`,
    `<span class="pill ${eligCls(f.eligibility?.state)}" title="${esc(f.eligibility?.note || "")}">${esc(f.eligibility?.label || "Eligibility ?")}</span>`,
  ].join("");
  const facts = [ev.term?.value, ev.compensation?.value, ev.work_mode?.value].filter(Boolean).map(esc).join(" · ");
  const state = o.user_state === "saved" ? `<span class="pill b">Saved</span>` : o.user_state === "dismissed" ? `<span class="pill">Dismissed</span>` : "";
  return `<div class="card">
    <div class="co">${esc(o.company)} ${o.company_stage ? `<span class="pill">${esc(o.company_stage)}</span>` : ""} ${state}</div>
    <h4>${esc(o.title)}</h4>
    <div class="meta">${esc(o.location || "Location not stated")}${facts ? " · " + facts : ""}</div>
    <div class="scores">${pills}</div>
    <div class="meta small">${esc((f.interest?.reasons || []).slice(0, 2).join(" · "))}</div>
    <div class="meta small">Source: ${esc(o.source?.ats)} · ${o.status} · checked ${ago(o.last_checked)}</div>
    <div class="acts">
      <button class="btn sm" onclick="openOpp('${o.id}')">Details &amp; evidence</button>
      ${o.user_state !== "saved" ? `<button class="btn sm primary" onclick="setOpp('${o.id}','saved')">Save</button>` : `<button class="btn sm" onclick="show('pipeline')">In pipeline →</button>`}
      ${o.user_state !== "dismissed" ? `<button class="btn sm" onclick="setOpp('${o.id}','dismissed')">Dismiss</button>` : `<button class="btn sm" onclick="setOpp('${o.id}','new')">Restore</button>`}
    </div></div>`;
}
function paintDiscover() {
  paintSaved();
  const view = $("#d_view").value;
  let list = W.opps.filter((o) => view === "all" || o.user_state === view);
  if (view === "new" && W.lastRun) list = list.filter((o) => W.lastRun.has(o.id));
  $("#d_sources").innerHTML = (W.lastSources || []).map((s) => `<span class="${s.error ? "err" : ""}" title="${esc(s.feed)}">${esc(s.company)} ${s.error ? "⚠ " + esc(s.error) : s.jobs}</span>`).join("");
  $("#d_list").innerHTML = list.length ? list.slice(0, 150).map(oppCard).join("") : `<p class="muted">${view === "new" ? "Nothing yet. Run a search." : "Nothing here."}</p>`;
}
async function setOpp(id, state) {
  let reason = "";
  if (state === "dismissed") reason = prompt("Why dismiss? (optional, helps you later)") ?? "";
  try {
    const r = await api(`/opps/${id}/state`, { method: "POST", body: { state, reason } });
    const i = W.opps.findIndex((o) => o.id === id); if (i >= 0) W.opps[i] = r.opportunity;
    if (r.app) { W.apps = (await api("/apps")).apps; toast("Saved to your pipeline"); }
    if (W.tab === "discover") paintDiscover();
    if (!$("#drawer").hidden && W.drawerOpp === id) openOpp(id);
  } catch (e) { toast(e.message); }
}

const EV_ROWS = [["deadline", "Deadline"], ["term", "Term"], ["compensation", "Compensation"], ["work_mode", "Work mode"], ["sponsorship", "Visa sponsorship"], ["work_authorization", "Work authorization"], ["cpt_opt", "CPT / OPT"], ["language", "Language"]];
function evidenceTable(o) {
  const ev = o.evidence || {};
  const rows = EV_ROWS.map(([k, label]) => {
    const e = ev[k] || {};
    const val = e.value ? esc(e.value) : `<span class="ns">${esc(e.status || "not stated")}</span>`;
    const src = e.source_url ? ` <a href="${esc(safeUrl(e.source_url))}" target="_blank" rel="noopener">source</a> · ${fmtDate(e.checked_at)}${e.confidence ? ` · ${esc(e.method)} · ${esc(e.confidence)} confidence` : ""}` : "";
    return `<tr><th>${label}</th><td>${val}${e.quote ? `<div class="quote">“${esc(e.quote)}”</div>` : ""}<div class="small muted">${src}</div></td></tr>`;
  }).join("");
  const req = ev.required_qualifications?.value;
  return `<table class="ev">${rows}<tr><th>Requirements</th><td>${req ? `<ul>${req.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : `<span class="ns">not stated in a list we could read</span>`}</td></tr></table>`;
}
function fitBlock(o) {
  const f = o.fit || {};
  const e = f.eligibility || {}, x = f.experience || {}, i = f.interest || {};
  const claim = (id) => W.state.claims.find((c) => c.id === id);
  return `<h3>Fit — three separate questions</h3>
    <div class="note ${scoreCls(i.score) === "g" ? "g" : ""}"><b>Interest fit ${i.score ?? "–"}</b> <span class="muted small">(${esc(i.method || "")})</span>: ${esc(i.reasons?.join(" · ") || "—")}${i.missing?.length ? `<br><span class="muted">${esc(i.missing.join(" "))}</span>` : ""}</div>
    <div class="note"><b>Experience fit ${x.score ?? "?"}</b> <span class="muted small">(${esc(x.method || "")})</span>${x.missing?.length ? `: ${esc(x.missing.join(" "))}` : ""}
      ${(x.matched || []).map((m) => `<div class="small">✓ ${esc(m.requirement)} <span class="muted">${m.similarity ? `(${m.similarity}) ` : ""}← ${m.claims.map((id) => esc((claim(id)?.preferred_wording || claim(id)?.text || id).slice(0, 70))).join("; ")}</span></div>`).join("")}
      ${(x.unmatched || []).map((r) => `<div class="small muted">· ${esc(r)} <i>(no confirmed claim supports this)</i></div>`).join("")}
      ${(x.flags || []).map((fl) => `<div class="small" style="color:#ff9d90">⚠ ${esc(fl)}</div>`).join("")}</div>
    <div class="note ${eligCls(e.state) === "r" ? "r" : eligCls(e.state) === "g" ? "g" : ""}"><b>Eligibility: ${esc(e.label || "?")}</b> — ${esc(e.note || "")}
      ${(e.quotes || []).map((q) => `<div class="quote small">“${esc(q.quote)}” <a href="${esc(safeUrl(q.source_url))}" target="_blank" rel="noopener">source</a></div>`).join("")}
      <div class="small muted">${esc(e.disclaimer || "")}</div></div>`;
}
async function openOpp(id) {
  const { opportunity: o } = await api(`/opps/${id}`);
  W.drawerOpp = id;
  openDrawer(`<div class="co small" style="color:var(--amber);font-weight:700">${esc(o.company)}</div>
    <h2>${esc(o.title)}</h2>
    <div class="muted small">${esc(o.location)} · ${esc(o.department)} · ${esc(o.employment_type)}</div>
    <div class="bar">
      <a class="btn" href="${esc(safeUrl(o.canonical_url))}" target="_blank" rel="noopener">Open official posting ↗</a>
      <button class="btn" onclick="checkOpp('${o.id}', this)">Re-check if open</button>
      ${o.user_state !== "saved" ? `<button class="btn primary" onclick="setOpp('${o.id}','saved')">Save to pipeline</button>` : `<span class="pill b">In pipeline</span>`}
    </div>
    <div class="note ${o.status === "open" ? "g" : o.status === "closed" ? "r" : ""}">Status: <b>${esc(o.status)}</b> · ${esc(o.status_evidence?.method || "")} · checked ${fmtDate(o.last_checked)} ${new Date(o.last_checked).toLocaleTimeString()} · <a href="${esc(safeUrl(o.status_evidence?.source_url))}" target="_blank" rel="noopener">evidence</a></div>
    ${fitBlock(o)}
    <h3>Evidence from the posting</h3>${evidenceTable(o)}
    <h3>Source record</h3><div class="small muted">Feed: ${esc(o.source?.feed)} · ATS job id ${esc(o.source?.job_id)} · first seen ${fmtDate(o.first_seen)} · published ${fmtDate(o.published_at)}</div>
    <h3>Posting text</h3><div class="small muted" style="white-space:pre-wrap;max-height:340px;overflow:auto">${esc(o.description)}</div>`);
}
async function checkOpp(id, btn) {
  btn.disabled = true; btn.textContent = "Checking…";
  try { const { opportunity } = await api(`/opps/${id}/check`, { method: "POST" }); const i = W.opps.findIndex((o) => o.id === id); if (i >= 0) W.opps[i] = opportunity; toast(`Status: ${opportunity.status}`); openOpp(id); }
  catch (e) { toast(e.message); btn.disabled = false; }
}

// ---------- drawer ----------
function openDrawer(html) { $("#drawerbody").innerHTML = html; $("#drawer").hidden = false; $(".drawerin").scrollTop = 0; }
function closeDrawer() { $("#drawer").hidden = true; W.drawerOpp = null; W.drawerApp = null; }
$("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") closeDrawer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });

// ---------- pipeline ----------
function paintPipeline() {
  const sel = $("#p_stage");
  if (sel.options.length < 2) sel.innerHTML = `<option value="open">All open work</option>` + W.state.stages.map((s) => `<option value="${s}">${STAGE_LABEL[s]}</option>`).join("");
  const v = sel.value;
  const apps = W.apps.filter((a) => (v === "open" ? !CLOSED.includes(a.stage) : a.stage === v))
    .sort((a, b) => (a.deadline?.date || "9999").localeCompare(b.deadline?.date || "9999") || (a.updated_at < b.updated_at ? 1 : -1));
  $("#p_list").innerHTML = apps.length ? apps.map((a) => `<div class="app">
      <div><b>${esc(a.title)}</b><small>${esc(a.company)} · ${STAGE_LABEL[a.stage]}${a.opp ? ` · ${esc(a.opp.status)}` : ""}</small></div>
      <div class="small">${a.deadline?.date ? `Due <b>${esc(a.deadline.date)}</b> <span class="muted">(${esc(a.deadline.source)}${a.deadline.firm ? "" : ", not firm"})</span>` : `<span class="muted">No deadline</span>`}<br>${esc(a.next_action || "")}</div>
      <div class="blk ${a.blockers.length ? "" : "none"}">${a.blockers.length ? a.blockers.slice(0, 3).map(esc).join("<br>") + (a.blockers.length > 3 ? `<br>+${a.blockers.length - 3} more` : "") : "Nothing blocking"}</div>
      <button class="btn sm" onclick="openApp('${a.id}')">Open workspace</button></div>`).join("") : `<p class="muted">No applications here. Save roles from Discover.</p>`;
}
async function addManualApp() {
  const title = prompt("Role title"); if (!title) return;
  const company = prompt("Company"); if (!company) return;
  const url = prompt("Posting URL (optional)") || "";
  await api("/apps", { method: "POST", body: { title, company, url } });
  W.apps = (await api("/apps")).apps; paintPipeline();
}

function lineDiff(a, b) {
  const A = String(a || "").split("\n"), B = String(b || "").split("\n");
  const sa = new Set(A), sb = new Set(B);
  return [...A.filter((l) => !sb.has(l)).map((l) => `<span class="del">- ${esc(l)}</span>`), ...B.map((l) => (sa.has(l) ? `  ${esc(l)}` : `<span class="add">+ ${esc(l)}</span>`))].join("\n");
}
function artifactBlock(app, key, label, a) {
  if (!a) return "";
  const text = a.text ?? a.answer ?? "";
  const flags = a.flags || [];
  const claims = (a.claim_ids || []).map((id) => W.state.claims.find((c) => c.id === id)).filter(Boolean);
  return `<div class="art" data-key="${esc(key)}">
    <div class="bar"><b class="grow">${esc(label)}</b>${a.approved_at ? `<span class="pill g">Approved ${fmtDate(a.approved_at)}</span>` : `<span class="pill y">Not approved</span>`}${a.reused ? `<span class="pill b">Reused answer</span>` : ""}${a.written_by ? `<span class="pill b" title="Reworded by AI from your claims only; flags re-checked">AI: ${esc(a.written_by)}</span>` : ""}</div>
    ${a.question ? `<div class="small muted">Q: ${esc(a.question)}</div>` : ""}
    <textarea class="inp" id="t_${esc(key)}">${esc(text)}</textarea>
    <div class="small muted">Built from: ${claims.length ? claims.map((c) => `<span class="st ${c.status}">${c.status}</span> ${esc((c.preferred_wording || c.text).slice(0, 60))}`).join(" · ") : "no claims"}</div>
    ${flags.length ? `<div class="flags">${flags.map((f) => `<label><input type="checkbox" data-flag="${esc(f.id)}" ${(a.acknowledged || []).includes(f.id) ? "checked" : ""}/> ${esc(f.message)}</label>`).join("")}<div class="small muted">Edit the text to fix a flag, or tick it to acknowledge you've checked it.</div></div>` : `<div class="small" style="color:#8be3a8">No flags.</div>`}
    ${key === "resume" && a.base ? `<details><summary class="small muted">Changes vs. your full claims resume</summary><div class="diff">${lineDiff(a.base, text)}</div></details>` : ""}
    ${(a.versions || []).length ? `<details><summary class="small muted">${a.versions.length} earlier version(s)</summary>${a.versions.slice().reverse().map((v) => `<div class="diff" style="margin:6px 0">${esc(fmtDate(v.at))}${v.approved_at ? " (was approved)" : ""}\n${esc(v.text)}</div>`).join("")}</details>` : ""}
    <div class="bar">
      <button class="btn sm" onclick="saveArtifact('${app.id}','${esc(key)}')">Save edits</button>
      <button class="btn sm primary" onclick="approveArtifact('${app.id}','${esc(key)}')">Approve</button>
      ${key.startsWith("q:") && a.approved_at ? `<button class="btn sm" onclick="saveToLibrary('${app.id}','${esc(key.slice(2))}')">Save to answer library</button>` : ""}
      ${key !== "resume" && W.state.integrations.ai ? `<button class="btn sm" title="Rewords this draft with your ${W.state.profile.tier === "pro" ? "Pro" : "Basic"} model using only your claims and your voice. Paid per use." onclick="aiRewrite('${app.id}','${esc(key)}')">✨ Rewrite with AI</button>` : ""}
      ${key !== "resume" ? `<button class="btn sm" onclick="deleteArtifact('${app.id}','${esc(key)}')">Remove</button>` : `<button class="btn sm" onclick="draft('${app.id}','resume')">Regenerate</button>`}
    </div></div>`;
}
async function openApp(id) {
  const a = W.apps.find((x) => x.id === id) || (await api("/apps")).apps.find((x) => x.id === id);
  if (!a) return;
  W.drawerApp = id;
  const o = a.opp;
  const m = a.materials || {};
  const contactsHere = (W.contacts.length ? W.contacts : (W.contacts = (await api("/contacts")).contacts)).filter((c) => c.company && a.company && c.company.toLowerCase().includes(a.company.toLowerCase().split(" ")[0]));
  openDrawer(`<div class="co small" style="color:var(--amber);font-weight:700">${esc(a.company)}</div>
    <h2>${esc(a.title)}</h2>
    <div class="bar">${o ? `<button class="btn sm" onclick="openOpp('${o.id}')">Posting, evidence &amp; fit</button><a class="btn sm" href="${esc(safeUrl(o.canonical_url))}" target="_blank" rel="noopener">Official posting ↗</a><button class="btn sm" onclick="checkOpp('${o.id}', this).then(()=>openApp('${a.id}'))">Re-check if open</button>` : a.url ? `<a class="btn sm" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">Posting ↗</a>` : ""}</div>
    ${a.blockers.length ? `<div class="note">${a.blockers.map((b) => "• " + esc(b)).join("<br>")}</div>` : `<div class="note g">Nothing blocking.</div>`}
    <h3>Tracking</h3>
    <div class="form">
      <div class="row"><label>Stage <select class="inp" id="ap_stage">${W.state.stages.filter((s) => s !== "submitted" || a.stage === "submitted").map((s) => `<option value="${s}" ${s === a.stage ? "selected" : ""}>${STAGE_LABEL[s]}</option>`).join("")}</select></label>
        <label>Deadline <input class="inp" type="date" id="ap_deadline" value="${esc(a.deadline?.date || "")}" /></label>
        <label>Follow up <input class="inp" type="date" id="ap_follow" value="${esc(a.follow_up || "")}" /></label></div>
      ${a.deadline?.date ? `<div class="small muted">Deadline source: ${esc(a.deadline.source)}${a.deadline.quote ? ` — “${esc(a.deadline.quote)}”` : ""}${a.deadline.firm ? " · on your calendar" : " · not firm, so not on your calendar until you set it"}</div>` : ""}
      <input class="inp" id="ap_next" placeholder="Next action" value="${esc(a.next_action || "")}" />
      <input class="inp" id="ap_sched" placeholder="Expected schedule (e.g. OA in 2 weeks)" value="${esc(a.expected_schedule || "")}" />
      <textarea class="inp" id="ap_notes" rows="3" placeholder="Notes">${esc(a.notes || "")}</textarea>
      <div><button class="btn sm primary" onclick="saveApp('${a.id}')">Save tracking</button></div>
    </div>
    <h3>Materials <small class="muted">— drafted only from your claims ledger; approve each one</small></h3>
    <div class="bar">
      ${m.resume ? "" : `<button class="btn sm" onclick="draft('${a.id}','resume')">Draft resume version</button>`}
      ${m.cover_letter ? "" : `<button class="btn sm" onclick="draft('${a.id}','cover_letter')">Draft cover letter</button>`}
    </div>
    ${artifactBlock(a, "resume", "Resume (role version)", m.resume)}
    ${artifactBlock(a, "cover_letter", "Cover letter", m.cover_letter)}
    ${(m.questions || []).map((q) => artifactBlock(a, "q:" + q.id, "Application question", q)).join("")}
    <div class="bar"><input class="inp grow" id="ap_q" placeholder="Paste an application question from the employer's form" /><button class="btn sm" onclick="draftQuestion('${a.id}')">Draft answer</button></div>
    <h3>Final review &amp; submit</h3>
    ${a.stage === "submitted" || a.submission ? `<div class="note g">Submitted by you · final approval ${fmtDate(a.submission?.approved_at)} · packet ${esc(a.submission?.packet_hash || "")}${a.submission?.receipt ? `<br>Receipt: ${esc(a.submission.receipt)}` : ""}</div>` : `<button class="btn primary" onclick="reviewPacket('${a.id}')">Review final packet</button><div class="small muted">You submit on the employer's site yourself. The app records your approval and the exact packet.</div>`}
    <h3>People at ${esc(a.company)}</h3>
    ${contactsHere.length ? contactsHere.map((c) => `<div class="rowitem"><div class="grow"><div class="t">${esc(c.name)} <span class="muted small">${esc(c.role)}</span></div><div class="s">${esc(c.relationship || c.source)}</div></div><button class="btn sm" onclick="draftOutreach('${c.id}','${a.id}')">Draft message</button></div>`).join("") : `<div class="small muted">No contacts at this company yet. Import your LinkedIn connections or add someone in Contacts.</div>`}
    <h3>Activity</h3><div class="hist">${(a.history || []).slice().reverse().map((h) => `<div>${esc(new Date(h.at).toLocaleString())} — ${esc(h.type === "stage" ? `${STAGE_LABEL[h.from] || "new"} → ${STAGE_LABEL[h.to]}` : h.type)}${h.note ? ": " + esc(h.note) : ""}</div>`).join("")}</div>`);
}
async function refreshApp(app) { const i = W.apps.findIndex((x) => x.id === app.id); const full = (await api("/apps")).apps; W.apps = full; if (W.tab === "pipeline") paintPipeline(); if (W.drawerApp === app.id) openApp(app.id); }
async function saveApp(id) {
  try {
    const { app } = await api(`/apps/${id}`, { method: "PATCH", body: { stage: $("#ap_stage").value, deadline: $("#ap_deadline").value, follow_up: $("#ap_follow").value, next_action: $("#ap_next").value, expected_schedule: $("#ap_sched").value, notes: $("#ap_notes").value } });
    toast("Saved"); refreshApp(app);
  } catch (e) { toast(e.message); }
}
async function draft(id, kind) { try { const { app } = await api(`/apps/${id}/draft`, { method: "POST", body: { kind } }); refreshApp(app); } catch (e) { toast(e.message); } }
async function aiRewrite(id, key, btn) {
  const a = W.apps.find((x) => x.id === id);
  const body = key === "cover_letter" ? { kind: "cover_letter", ai: true } : (() => { const q = a.materials.questions.find((x) => "q:" + x.id === key); return { kind: "question", question: q.question, question_id: q.id, ai: true }; })();
  toast("Rewriting with AI…", 8000);
  try { const { app } = await api(`/apps/${id}/draft`, { method: "POST", body }); toast("Rewritten. Check the flags, then approve."); refreshApp(app); } catch (e) { toast(e.message, 6000); }
}
async function draftQuestion(id) { const q = $("#ap_q").value.trim(); if (!q) return toast("Paste the question first"); try { const { app } = await api(`/apps/${id}/draft`, { method: "POST", body: { kind: "question", question: q } }); refreshApp(app); } catch (e) { toast(e.message); } }
async function saveArtifact(id, key) { try { const { app } = await api(`/apps/${id}/artifact`, { method: "PUT", body: { key, text: $(`[id="t_${key}"]`).value } }); toast("Saved. Flags re-checked; approve again when ready."); refreshApp(app); } catch (e) { toast(e.message); } }
async function approveArtifact(id, key) {
  const box = $(`.art[data-key="${CSS.escape(key)}"]`);
  const ta = $(`[id="t_${key}"]`);
  const a = W.apps.find((x) => x.id === id);
  const cur = key.startsWith("q:") ? a.materials.questions.find((q) => "q:" + q.id === key) : a.materials[key];
  if ((cur.text ?? cur.answer) !== ta.value) return toast("Save your edits first, then approve.");
  const acknowledge = $$("input[data-flag]", box).filter((x) => x.checked).map((x) => x.dataset.flag);
  try { const { app } = await api(`/apps/${id}/approve`, { method: "POST", body: { key, acknowledge } }); toast("Approved"); refreshApp(app); } catch (e) { toast(e.message, 6000); }
}
async function deleteArtifact(id, key) { if (!confirm("Remove this draft?")) return; const { app } = await api(`/apps/${id}/artifact`, { method: "DELETE", body: { key } }); refreshApp(app); }
async function saveToLibrary(id, qid) { const tags = splitList(prompt("Tags for this answer (comma separated)", "") || ""); const reconfirm = confirm("Mark as 'reconfirm before reuse'? (OK = yes)"); try { await api(`/apps/${id}/save-answer`, { method: "POST", body: { question_id: qid, tags, reconfirm } }); toast("Saved to answer library"); } catch (e) { toast(e.message); } }
async function reviewPacket(id) {
  const p = await api(`/apps/${id}/packet`);
  const a = W.apps.find((x) => x.id === id);
  openDrawer(`<h2>Final review: ${esc(a.title)} at ${esc(a.company)}</h2>
    <div class="note">Destination: <b>${esc(p.destination || "not set")}</b><br>Posting status: ${esc(p.status)} · checked ${fmtDate(p.last_checked)}${p.eligibility ? `<br>Eligibility: <b>${esc(p.eligibility.label)}</b> — ${esc(p.eligibility.note)}` : ""}</div>
    ${p.unresolved.length ? `<div class="note r"><b>Not ready:</b><br>${p.unresolved.map((u) => "• " + esc(u)).join("<br>")}</div>` : ""}
    <div class="packet">${esc(p.text)}</div>
    <div class="small muted">Packet fingerprint ${esc(p.hash)}. If anything changes, you'll need to review again.</div>
    ${p.unresolved.length ? `<div class="bar"><button class="btn" onclick="openApp('${id}')">← Back to workspace</button></div>` : `
    <div class="form" style="margin-top:12px">
      <label class="chk"><input type="checkbox" id="fin_ok" /> I reviewed every document and answer above, I'll answer any legal or work-authorization questions on the form myself, and I'm submitting this on the employer's site.</label>
      <input class="inp" id="fin_receipt" placeholder="Confirmation number or receipt (optional)" />
      <div class="bar"><button class="btn" onclick="openApp('${id}')">← Back</button>${p.destination ? `<a class="btn" href="${esc(safeUrl(p.destination))}" target="_blank" rel="noopener">Open application form ↗</a>` : ""}<button class="btn primary" onclick="submitApp('${id}','${esc(p.hash)}')">Record final approval &amp; mark submitted</button></div>
    </div>`}`);
}
async function submitApp(id, hash) {
  if (!$("#fin_ok").checked) return toast("Tick the confirmation first");
  try { const { app } = await api(`/apps/${id}/submit`, { method: "POST", body: { confirm: true, hash, receipt: $("#fin_receipt").value } }); toast("Recorded as submitted"); refreshApp(app); }
  catch (e) { toast(e.message, 6000); }
}

// ---------- contacts + outreach ----------
async function loadContacts() {
  const [c, o] = await Promise.all([api("/contacts"), api("/outreach")]);
  W.contacts = c.contacts; W.outreach = o.outreach;
  $("#c_apollo").innerHTML = W.state.integrations.apollo
    ? `<h3>Find people with Apollo <small class="muted">(your free key · search only, no credits)</small></h3><div class="bar"><input id="ap_co" class="inp" placeholder="Company name" /><input id="ap_dom" class="inp" placeholder="or domain (figure.ai)" /><input id="ap_titles" class="inp grow" placeholder="Titles: recruiter, product manager" /><button class="btn" onclick="apolloSearch()">Search</button></div><div id="ap_res"></div><p class="small muted">Results are unverified leads. Apollo's terms allow internal use only; don't paste them into LinkedIn automation.</p>`
    : `<h3>Apollo (optional)</h3><p class="small muted">Off. Apollo has a free plan whose people search costs no credits but returns no emails. To turn it on, add your own key as <code>APOLLO_API_KEY</code> in <code>.env</code> (see docs/COSTS.md). Not required.</p>`;
  paintContacts();
}
function paintContacts() {
  const q = ($("#c_filter").value || "").toLowerCase();
  const list = W.contacts.filter((c) => !q || `${c.name} ${c.company}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  const emailLbl = { verified: "verified", from_export: "from your LinkedIn export", user_provided: "you provided", inferred: "GUESSED — unverified", none: "" };
  $("#c_list").innerHTML = list.length ? list.slice(0, 300).map((c) => `<div class="rowitem"><div class="grow">
      <div class="t"><b>${esc(c.name)}</b> <span class="muted small">${esc(c.role)}${c.company ? " · " + esc(c.company) : ""}</span> ${c.opt_out ? `<span class="pill r">opted out</span>` : ""}</div>
      <div class="s">${esc(c.relationship || "")} · source: ${esc(c.source)} · ${esc(c.verification)}${c.email ? ` · ${esc(c.email)} (${esc(emailLbl[c.email_status] || c.email_status)})` : ""}${c.follow_up ? ` · follow up ${esc(c.follow_up)}` : ""}</div></div>
      ${c.profile_url ? `<a class="btn sm" href="${esc(safeUrl(c.profile_url))}" target="_blank" rel="noopener">Profile ↗</a>` : ""}
      <button class="btn sm" onclick="draftOutreach('${c.id}')" ${c.opt_out ? "disabled" : ""}>Draft message</button>
      <button class="btn sm" onclick="delContact('${c.id}')">×</button></div>`).join("") + (list.length > 300 ? `<p class="muted small">Showing 300 of ${list.length}. Filter to narrow down.</p>` : "") : `<p class="muted">No contacts yet.</p>`;
  const cname = new Map(W.contacts.map((c) => [c.id, c]));
  $("#o_list").innerHTML = W.outreach.length ? W.outreach.map((o) => { const c = cname.get(o.contact_id); return `<div class="rowitem"><div class="grow"><div class="t"><b>${esc(c?.name || "?")}</b> <span class="pill ${o.status === "sent" ? "b" : o.status === "approved" ? "g" : ["replied", "meeting", "referred"].includes(o.status) ? "g" : ""}">${esc(o.status)}</span> <span class="small muted">${esc(o.channel)}${o.sent_at ? " · sent " + fmtDate(o.sent_at) : ""}${o.follow_up ? " · follow up " + esc(o.follow_up) : ""}</span></div><div class="s" style="white-space:pre-wrap">${esc((o.approved_text || o.text).slice(0, 220))}</div></div><button class="btn sm" onclick="openOutreach('${o.id}')">Open</button></div>`; }).join("") : `<p class="muted small">No messages yet.</p>`;
}
async function importConnections(input) {
  const f = input.files[0]; if (!f) return;
  try { const r = await api("/contacts/import-linkedin", { method: "POST", body: { csv: await f.text() } }); toast(`Imported ${r.added} new, updated ${r.updated}`); loadContacts(); }
  catch (e) { toast(e.message, 6000); }
  input.value = "";
}
async function addContact() {
  const body = Object.fromEntries($$("#c_form [name]").map((el) => [el.name, el.value.trim()]));
  if (!body.name) return toast("Name is required");
  if (!body.email) body.email_status = "none";
  body.source = "manual"; body.verification = body.source_url ? "verified" : "unverified";
  try { await api("/contacts", { method: "POST", body }); $$("#c_form input").forEach((x) => (x.value = "")); toast("Added"); loadContacts(); } catch (e) { toast(e.message); }
}
async function delContact(id) { if (!confirm("Delete this contact?")) return; await api(`/contacts/${id}`, { method: "DELETE" }); loadContacts(); }
async function apolloSearch() {
  try {
    const { people } = await api("/apollo/search", { method: "POST", body: { company: $("#ap_co").value, domain: $("#ap_dom").value, titles: splitList($("#ap_titles").value) } });
    W.apolloRes = people;
    $("#ap_res").innerHTML = people.length ? people.map((p, i) => `<div class="rowitem"><div class="grow"><b>${esc(p.name)}</b> <span class="muted small">${esc(p.role)} · ${esc(p.company)}</span></div><button class="btn sm" onclick="addApollo(${i})">Add as unverified</button></div>`).join("") : `<p class="muted small">No results.</p>`;
  } catch (e) { toast(e.message, 6000); }
}
async function addApollo(i) { await api("/contacts", { method: "POST", body: W.apolloRes[i] }); toast("Added (unverified)"); loadContacts(); }
async function draftOutreach(contactId, appId) {
  const c = W.contacts.find((x) => x.id === contactId);
  const channel = c?.email ? (confirm(`Draft an email to ${c.name}? (Cancel = LinkedIn note)`) ? "email" : "linkedin") : "linkedin";
  try { const { outreach } = await api("/outreach/draft", { method: "POST", body: { contact_id: contactId, app_id: appId || null, channel } }); W.outreach.unshift(outreach); openOutreach(outreach.id); }
  catch (e) { toast(e.message); }
}
function openOutreach(id) {
  const o = W.outreach.find((x) => x.id === id); const c = W.contacts.find((x) => x.id === o.contact_id) || {};
  const sendLink = o.channel === "email" && c.email ? `mailto:${encodeURIComponent(c.email)}?body=${encodeURIComponent(o.approved_text || "")}` : c.profile_url || "";
  openDrawer(`<h2>Message to ${esc(c.name || "?")}</h2><div class="muted small">${esc(o.channel)} · ${esc(c.role || "")} ${c.company ? "· " + esc(c.company) : ""}${c.email ? ` · ${esc(c.email)} (${esc(c.email_status)})` : ""}</div>
    ${c.email_status === "inferred" ? `<div class="note r">This email is a guess. Don't send to it until you've confirmed it.</div>` : ""}
    <div class="art" data-key="out">
      <textarea class="inp" id="out_text" ${o.sent_at ? "readonly" : ""}>${esc(o.text)}</textarea>
      ${o.channel === "linkedin" ? `<div class="small muted"><span id="out_len">${o.text.length}</span>/300 characters (LinkedIn connection-note limit)</div>` : ""}
      ${(o.flags || []).length ? `<div class="flags">${o.flags.map((f) => `<label><input type="checkbox" data-flag="${esc(f.id)}" ${(o.acknowledged || []).includes(f.id) ? "checked" : ""}/> ${esc(f.message)}</label>`).join("")}</div>` : ""}
      ${o.written_by ? `<div class="small muted">Reworded by ${esc(o.written_by)} from your claims only.</div>` : ""}
    ${o.sent_at ? `<div class="note g">Sent by you on ${fmtDate(o.sent_at)}. Exact text recorded.</div>` : `<div class="bar"><button class="btn sm" onclick="saveOutreach('${o.id}')">Save edits</button>${W.state.integrations.ai ? `<button class="btn sm" onclick="aiOutreach('${o.id}')">✨ Rewrite with AI</button>` : ""}<button class="btn sm primary" onclick="approveOutreach('${o.id}')">Approve this exact text</button></div>`}
    </div>
    ${o.status === "approved" && !o.sent_at ? `<div class="note">Approved. Send it yourself, then log it:<div class="bar"><button class="btn sm" onclick="navigator.clipboard.writeText(${esc(JSON.stringify(o.approved_text))});toast('Copied')">Copy text</button>${sendLink ? `<a class="btn sm" href="${esc(sendLink.startsWith("mailto:") ? sendLink : safeUrl(sendLink))}" target="_blank" rel="noopener">${o.channel === "email" ? "Open in email app" : "Open their profile"} ↗</a>` : ""}<button class="btn sm primary" onclick="markSent('${o.id}')">I sent it</button></div></div>` : ""}
    ${o.sent_at ? `<div class="bar">${["replied", "meeting", "referred", "no_reply", "opted_out"].map((s) => `<button class="btn sm" onclick="outStatus('${o.id}','${s}')">${s.replace("_", " ")}</button>`).join("")}</div>` : ""}
    <div class="hist">${(o.history || []).map((h) => `<div>${esc(new Date(h.at).toLocaleString())} — ${esc(h.type)}${h.to ? " → " + esc(h.to) : ""}</div>`).join("")}</div>
    <div class="bar"><button class="btn sm" onclick="delOutreach('${o.id}')">Delete</button></div>`);
  const ta = $("#out_text"); if (ta && $("#out_len")) ta.oninput = () => ($("#out_len").textContent = ta.value.length);
}
async function aiOutreach(id) {
  const o = W.outreach.find((x) => x.id === id);
  toast("Rewriting with AI…", 8000);
  try {
    const { outreach } = await api("/outreach/draft", { method: "POST", body: { contact_id: o.contact_id, app_id: o.app_id, channel: o.channel, ai: true } });
    await api(`/outreach/${id}`, { method: "DELETE" });
    W.outreach = [outreach, ...W.outreach.filter((x) => x.id !== id)];
    openOutreach(outreach.id); toast("Rewritten. Check it, then approve.");
  } catch (e) { toast(e.message, 6000); }
}
async function updOut(o) { const i = W.outreach.findIndex((x) => x.id === o.id); W.outreach[i] = o; openOutreach(o.id); if (W.tab === "contacts") paintContacts(); }
async function saveOutreach(id) { try { const { outreach } = await api(`/outreach/${id}`, { method: "PUT", body: { text: $("#out_text").value } }); toast("Saved"); updOut(outreach); } catch (e) { toast(e.message); } }
async function approveOutreach(id) {
  const o = W.outreach.find((x) => x.id === id);
  if ($("#out_text").value !== o.text) return toast("Save your edits first, then approve.");
  const acknowledge = $$("input[data-flag]", $(".art[data-key=out]")).filter((x) => x.checked).map((x) => x.dataset.flag);
  try { const { outreach } = await api(`/outreach/${id}/approve`, { method: "POST", body: { acknowledge } }); toast("Approved"); updOut(outreach); } catch (e) { toast(e.message, 6000); }
}
async function markSent(id) { try { const { outreach } = await api(`/outreach/${id}/sent`, { method: "POST" }); toast("Logged as sent. Follow-up set for a week."); updOut(outreach); } catch (e) { toast(e.message); } }
async function outStatus(id, status) { const { outreach } = await api(`/outreach/${id}/status`, { method: "POST", body: { status } }); updOut(outreach); }
async function delOutreach(id) { if (!confirm("Delete this message record?")) return; await api(`/outreach/${id}`, { method: "DELETE" }); W.outreach = W.outreach.filter((x) => x.id !== id); closeDrawer(); paintContacts(); }

// ---------- answers ----------
async function loadAnswers() {
  W.answers = (await api("/answers")).answers;
  $("#a_list").innerHTML = W.answers.length ? W.answers.map((a) => `<div class="rowitem"><div class="grow"><div class="t"><b>${esc(a.question)}</b> ${a.approved_at ? `<span class="pill g">approved</span>` : `<span class="pill y">needs approval</span>`} ${a.reconfirm ? `<span class="pill y">reconfirm before reuse</span>` : ""}</div><div class="s" style="white-space:pre-wrap">${esc(a.answer)}</div><div class="s">${(a.tags || []).map(esc).join(", ")}${a.context ? " · from " + esc(a.context) : ""}</div></div><button class="btn sm" onclick="delAnswer('${a.id}')">×</button></div>`).join("") : `<p class="muted">No saved answers yet. Approve an answer in an application and save it here, or add one above.</p>`;
}
async function addAnswer() {
  const question = $("#a_q").value.trim(), answer = $("#a_a").value.trim();
  if (!question || !answer) return toast("Question and answer are required");
  await api("/answers", { method: "POST", body: { question, answer, tags: splitList($("#a_tags").value), reconfirm: $("#a_re").checked, approve: true } });
  $("#a_q").value = $("#a_a").value = $("#a_tags").value = ""; loadAnswers();
}
async function delAnswer(id) { if (!confirm("Delete this answer?")) return; await api(`/answers/${id}`, { method: "DELETE" }); loadAnswers(); }

// ---------- profile + claims ----------
function paintProfile() {
  const p = W.state.profile, pr = p.preferences || {};
  for (const el of $$("#pf_basic [name]")) el.value = p[el.name] || "";
  $("#pf_fams").innerHTML = Object.entries(W.state.families).map(([k, v]) => `<label class="chip"><input type="checkbox" name="fam" value="${k}" ${(pr.role_families || []).includes(k) ? "checked" : ""}/> ${esc(v)}</label>`).join("");
  $$("#pf_prefs [name=ind]").forEach((x) => (x.checked = (pr.industries || []).includes(x.value)));
  $$("#pf_prefs [name=stage]").forEach((x) => (x.checked = (pr.company_stages || []).includes(x.value)));
  const f = (n) => $(`#pf_prefs [name=${n}]`);
  f("locations").value = (pr.locations || []).join(", "); f("include_remote").checked = pr.include_remote !== false;
  for (const n of ["term", "start_date", "end_date", "days_per_week", "comp_min", "learning_goals"]) f(n).value = pr[n] || "";
  $("#pf_prio").innerHTML = PRIOS.map(([k, l]) => `<label>${l} <input type="range" min="0" max="3" step="1" data-prio="${k}" value="${(pr.priorities || {})[k] || 0}" /></label>`).join("");
  const el = p.eligibility || {};
  $("#pf_eligrows").innerHTML = ELIG_FIELDS.map(([k, l]) => `<div class="row"><input class="inp grow" data-elig="${k}" placeholder="${esc(l)}" value="${esc(el[k]?.value || "")}" /><input class="inp" data-elig-ev="${k}" placeholder="Evidence / reference (optional)" value="${esc(el[k]?.evidence || "")}" /><label class="chk"><input type="checkbox" data-elig-ok="${k}" ${el[k] ? "checked" : ""}/> I confirm</label>${el[k] ? `<span class="small muted">confirmed ${esc(el[k].confirmed_on)}</span>` : ""}</div>`).join("");
  $("#pf_corr").value = (p.corrections || []).map((c) => `${c.from} => ${c.to}`).join("\n");
  $("#pf_excl").value = (p.exclusions || []).join("\n");
  const dis = new Set(p.seed_disabled || []);
  $("#pf_seed").innerHTML = W.state.seed_companies.map((c) => `<label><input type="checkbox" data-seed="${c.ats}:${c.board}" ${dis.has(`${c.ats}:${c.board}`) ? "" : "checked"}/> ${esc(c.name)} <span class="muted">${c.ats}</span></label>`).join("");
  W.boards = [...(p.boards || [])]; paintBoards();
  paintVoice();
  $("#pf_saved").textContent = p.from_onboarding ? "Prefilled from your onboarding answers. Check them and press Save profile." : $("#pf_saved").textContent;
  paintClaims();
}
function paintVoice() {
  const v = W.state.profile.voice || {};
  $("#voice_samples").innerHTML = (v.samples || []).map((x) => `<div class="rowitem"><div class="grow"><div class="t"><b>${esc(x.title)}</b></div><div class="s">${esc(x.text.slice(0, 160))}…</div></div><button class="btn sm" onclick="delVoice('${x.id}')">×</button></div>`).join("") || `<p class="muted small">No samples yet. Two to five pieces you're proud of works best: posts, essays, emails.</p>`;
  $("#voice_guide").value = v.guide || "";
  $("#voice_an").disabled = !W.state.integrations.ai || !(v.samples || []).length;
  $("#voice_note").textContent = !W.state.integrations.ai ? "Learning your style needs the AI key; you can still write style notes yourself." : v.guide_at ? `Learned ${fmtDate(v.guide_at)} by ${v.guide_model}` : "";
}
async function voiceFile(input) {
  const f = input.files[0]; if (!f) return;
  try { $("#voice_text").value = await extractFileText(f); if (!$("#voice_title").value) $("#voice_title").value = f.name.replace(/\.[^.]+$/, ""); toast("Read the file. Check it, then Add sample."); }
  catch (e) { toast("Couldn't read that file: " + e.message); }
  input.value = "";
}
async function addVoice() {
  try { const { profile } = await api("/voice/samples", { method: "POST", body: { title: $("#voice_title").value.trim(), text: $("#voice_text").value } }); W.state.profile = profile; $("#voice_text").value = $("#voice_title").value = ""; paintVoice(); toast("Sample added"); }
  catch (e) { toast(e.message, 5000); }
}
async function delVoice(id) { const { profile } = await api(`/voice/samples/${id}`, { method: "DELETE" }); W.state.profile = profile; paintVoice(); }
async function analyzeVoice() {
  $("#voice_an").disabled = true; $("#voice_note").textContent = "Reading your samples…";
  try { const { profile } = await api("/voice/analyze", { method: "POST" }); W.state.profile = profile; paintVoice(); toast("Style learned. AI rewrites will use it."); }
  catch (e) { toast(e.message, 5000); paintVoice(); }
}
async function saveVoiceGuide() { const { profile } = await api("/voice/guide", { method: "PUT", body: { guide: $("#voice_guide").value } }); W.state.profile = profile; paintVoice(); toast("Style notes saved"); }
function paintBoards() { $("#pf_boards").innerHTML = W.boards.map((b, i) => `<div class="rowitem"><div class="grow small">${esc(b.name)} <span class="muted">${esc(b.ats)}:${esc(b.board)}</span></div><button class="btn sm" onclick="W.boards.splice(${i},1);paintBoards()">×</button></div>`).join(""); }
async function addBoard() {
  const ats = $("#pf_bats").value, board = $("#pf_bname").value.trim();
  if (!board) return;
  const r = await api("/boards/test", { method: "POST", body: { ats, board } }).catch((e) => ({ error: e.message }));
  if (!r.ok) return toast(`Couldn't read that board: ${r.error}`, 5000);
  W.boards.push({ name: board, ats, board }); paintBoards(); $("#pf_bname").value = "";
  toast(`Found ${r.jobs} jobs. Save profile to keep it.`);
}
async function saveProfile() {
  const body = Object.fromEntries($$("#pf_basic [name]").map((el) => [el.name, el.value.trim()]));
  const f = (n) => $(`#pf_prefs [name=${n}]`);
  body.preferences = {
    role_families: $$("#pf_fams input:checked").map((x) => x.value), industries: $$("#pf_prefs [name=ind]:checked").map((x) => x.value),
    company_stages: $$("#pf_prefs [name=stage]:checked").map((x) => x.value), locations: splitList(f("locations").value), include_remote: f("include_remote").checked,
    term: f("term").value.trim(), start_date: f("start_date").value, end_date: f("end_date").value, days_per_week: f("days_per_week").value.trim(), comp_min: f("comp_min").value.trim(), learning_goals: f("learning_goals").value.trim(),
    priorities: Object.fromEntries($$("[data-prio]").map((x) => [x.dataset.prio, +x.value])),
  };
  body.eligibility = Object.fromEntries(ELIG_FIELDS.map(([k]) => [k, { value: $(`[data-elig=${k}]`).value.trim(), evidence: $(`[data-elig-ev=${k}]`).value.trim(), confirmed: $(`[data-elig-ok=${k}]`).checked }]));
  const unconfirmed = ELIG_FIELDS.filter(([k]) => $(`[data-elig=${k}]`).value.trim() && !$(`[data-elig-ok=${k}]`).checked);
  body.corrections = $("#pf_corr").value.split("\n").map((l) => l.split("=>")).filter((x) => x.length === 2 && x[0].trim()).map(([a, b]) => ({ from: a.trim(), to: b.trim() }));
  body.exclusions = $("#pf_excl").value.split("\n").map((x) => x.trim()).filter(Boolean);
  body.seed_disabled = $$("[data-seed]").filter((x) => !x.checked).map((x) => x.dataset.seed);
  body.boards = W.boards;
  body.tier = W.state.profile.tier || "basic";
  try {
    const { profile } = await api("/profile", { method: "PUT", body });
    W.state.profile = profile;
    await api("/opps/reassess", { method: "POST" }); W.opps = (await api("/opps?state=all")).opportunities;
    $("#pf_saved").textContent = `Saved ${new Date().toLocaleTimeString()} · fit scores updated` + (unconfirmed.length ? ` · ${unconfirmed.length} eligibility field(s) not saved because “I confirm” isn't ticked` : "");
    paintProfile();
  } catch (e) { toast(e.message); }
}
function paintClaims() {
  const cs = W.state.claims;
  const sec = { education: "Education", experience: "Experience", leadership: "Leadership", project: "Projects", skill: "Skills", other: "Other" };
  $("#pf_claims").innerHTML = cs.length ? Object.keys(sec).map((s) => { const g = cs.filter((c) => c.section === s); return g.length ? `<div class="lbl" style="margin-top:12px">${sec[s]}</div>` + g.map((c) => `<div class="rowitem"><span class="st ${c.status}">${c.status.replace("_", " ")}</span><div class="grow"><div class="t">${esc(c.preferred_wording || c.text || "(empty)")}</div><div class="s">${esc([c.title, c.org, c.dates].filter(Boolean).join(" · "))} · source: ${esc(c.source)}${c.confirmed_on ? " · confirmed " + esc(c.confirmed_on) : ""}${c.evidence ? " · evidence: " + esc(c.evidence) : ""}</div></div><button class="btn sm" onclick="editClaim('${c.id}')">Edit</button></div>`).join("") : ""; }).join("") : `<p class="muted">No claims yet. Import them from your resume or add them by hand. Nothing is used in drafts until you mark it verified or approximate.</p>`;
}
function editClaim(id) {
  const c = W.state.claims.find((x) => x.id === id) || { section: "experience", status: "unreviewed" };
  openDrawer(`<h2>${id ? "Edit claim" : "New claim"}</h2><div class="form" id="cl_form">
    <div class="row"><label>Section <select class="inp" name="section">${["education", "experience", "leadership", "project", "skill", "other"].map((s) => `<option ${s === c.section ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>Status <select class="inp" name="status">${W.state.claim_statuses.map((s) => `<option value="${s}" ${s === c.status ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}</select></label></div>
    <input class="inp" name="title" placeholder="Title (exactly as you want it)" value="${esc(c.title || "")}" />
    <input class="inp" name="org" placeholder="Organization" value="${esc(c.org || "")}" />
    <div class="row"><input class="inp" name="dates" placeholder="Dates (e.g. Jun 2025 – Aug 2025)" value="${esc(c.dates || "")}" /><input class="inp" name="location" placeholder="Location" value="${esc(c.location || "")}" /></div>
    <textarea class="inp" name="text" rows="2" placeholder="The fact, as originally stated">${esc(c.text || "")}</textarea>
    <textarea class="inp" name="preferred_wording" rows="3" placeholder="Preferred wording (used in drafts)">${esc(c.preferred_wording || "")}</textarea>
    <input class="inp" name="skills" placeholder="Skills shown by this (comma separated)" value="${esc((c.skills || []).join(", "))}" />
    <input class="inp" name="tags" placeholder="Tags (comma separated)" value="${esc((c.tags || []).join(", "))}" />
    <input class="inp" name="evidence" placeholder="Evidence (link or note: where this can be checked)" value="${esc(c.evidence || "")}" />
    <p class="small muted">Numbers in drafts are flagged unless they appear in a <b>verified</b> claim. Mark a metric <b>approximate</b> if you're not sure of the exact figure.</p>
    <div class="bar"><button class="btn primary" onclick="saveClaim('${id || ""}')">Save claim</button>${id ? `<button class="btn dangerbtn" onclick="deleteClaim('${id}')">Delete</button>` : ""}</div>
    ${(c.history || []).length ? `<details><summary class="small muted">History</summary><div class="hist">${c.history.slice().reverse().map((h) => `<div>${esc(new Date(h.at).toLocaleString())}: ${esc(h.status)} — ${esc(h.preferred_wording || "")}</div>`).join("")}</div></details>` : ""}
  </div>`);
}
async function saveClaim(id) {
  const body = Object.fromEntries($$("#cl_form [name]").map((el) => [el.name, el.value.trim()]));
  body.skills = splitList(body.skills); body.tags = splitList(body.tags); if (id) body.id = id;
  if (!body.preferred_wording) body.preferred_wording = body.text;
  try { await api("/claims", { method: "POST", body }); W.state = await api("/state"); closeDrawer(); paintClaims(); toast("Claim saved"); } catch (e) { toast(e.message); }
}
async function deleteClaim(id) { if (!confirm("Delete this claim?")) return; await api(`/claims/${id}`, { method: "DELETE" }); W.state = await api("/state"); closeDrawer(); paintClaims(); }
async function importResumeClaims() { try { const r = await api("/claims/import-resume", { method: "POST" }); W.state = await api("/state"); paintClaims(); toast(`Imported ${r.imported} claims as unreviewed. Review each one.`, 4000); } catch (e) { toast(e.message, 5000); } }

// ---------- data ----------
function paintData() {
  const i = W.state.integrations;
  $("#data_integrations").innerHTML = `<div>Job boards (Greenhouse, Lever, Ashby): <b>on · free</b></div><div>Apollo people search: <b>${i.apollo ? "on (your key)" : "off"}</b></div><div>Linq mobile alerts: <b>off</b> (paid provider, not set up)</div><div>Ranking by meaning: <b>local model, free</b> (${esc(i.meaning_model)})</div><div>AI rewrites in this workspace: <b>${i.ai ? `on · Basic ${esc(i.ai_models.basic)} / Pro ${esc(i.ai_models.pro)} (you're on ${W.state.profile.tier === "pro" ? "Pro" : "Basic"}) · web search ${esc(i.ai_models.search)} · paid per use` : "off (no Anthropic key)"}</b>. Drafts always start from your claims.</div><div>Main chat AI: <b>${i.ai ? "on (your key, paid per use)" : "off"}</b></div>`;
}
async function importJSON(input) {
  const f = input.files[0]; if (!f) return;
  try { const r = await api("/import", { method: "POST", body: JSON.parse(await f.text()) }); toast(`Imported ${r.imported} records. ${r.note}`, 5000); await loadState(); }
  catch (e) { toast("Import failed: " + e.message, 5000); }
  input.value = "";
}
async function deleteAll() {
  if ($("#del_confirm").value !== "DELETE") return toast("Type DELETE to confirm");
  if (!confirm("Permanently delete all workspace data? This can't be undone.")) return;
  await api("/all", { method: "DELETE", body: { confirm: "DELETE" } });
  toast("Deleted"); await loadState(); show("profile");
}

boot().catch((e) => toast(e.message, 6000));
