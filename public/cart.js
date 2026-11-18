// Cart ("my list"): saved opportunities, priority view, detail page with checklist, calendar subscription.
// Uses globals from index.html: $, esc, call, fmtDate, AUTH.
const CART = { items: [], poll: null, cal: null };
const STATUS_TEXT = { saved: "Saved", applying: "Applying", submitted: "Submitted", interview: "Interviewing", offer: "Offer 🎉", dropped: "Dropped" };
const KIND_ICON = { deadline: "⏰", info_session: "🎤", office_hours: "🕐", event: "📍", coffee_chat: "☕" };
const daysUntil = (iso) => (iso ? Math.ceil((new Date(iso + "T23:59:00") - new Date()) / 864e5) : null);

// Priority: soonest deadline first; items with no deadline after, by fit. Done/dropped at the end.
function priority(it) {
  if (["dropped", "offer"].includes(it.status)) return 1e6;
  if (it.status === "submitted" || it.status === "interview") return 5e5 + (100 - (it.opp.fit || 0));
  const d = daysUntil(it.opp.deadline) ?? nextEventDays(it);
  const fitBoost = (it.opp.fit || 0) / 10;
  return (d == null ? 400 : Math.max(d, 0)) - fitBoost;
}
function nextEventDays(it) {
  const ds = (it.detail?.events || []).map((e) => daysUntil(e.date)).filter((d) => d != null && d >= 0);
  return ds.length ? Math.min(...ds) : null;
}

async function loadCart() {
  try {
    const { items } = await call("/api/cart", { method: "GET" });
    CART.items = items;
    renderCart();
    // Keep polling while any item is still being researched.
    clearTimeout(CART.poll);
    if (items.some((i) => !i.detail)) CART.poll = setTimeout(loadCart, 3500);
  } catch {}
}

async function addToCart(opp, btn) {
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
    const { item, created } = await call("/api/cart", { body: { opp } });
    if (created) CART.items.unshift(item);
    renderCart();
    toast(created ? `Added “${opp.title}” to your list — researching dates…` : "Already on your list");
    clearTimeout(CART.poll); CART.poll = setTimeout(loadCart, 3000);
    if (btn) btn.textContent = "✓ On your list";
  } catch (e) { toast(e.message); if (btn) { btn.disabled = false; btn.textContent = "+ Add to my list"; } }
}

function renderCart() {
  $("#cartcount").textContent = CART.items.filter((i) => i.status !== "dropped").length || "";
  const sec = $("#list");
  const items = [...CART.items].sort((a, b) => priority(a) - priority(b));
  sec.hidden = !items.length;
  if (!items.length) return;
  $("#listrows").innerHTML = items.map((it, rank) => {
    const d = daysUntil(it.opp.deadline);
    const total = it.detail?.checklist?.length || 0;
    const done = stepsDone(it).length, reachN = reachSet(it).size, pplN = (it.detail?.people || []).length;
    const urgent = d != null && d <= 14 && !["submitted", "interview", "offer", "dropped"].includes(it.status);
    const nextEv = (it.detail?.events || []).filter((e) => e.date && daysUntil(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
    return `<div class="lrow ${it.status === "dropped" ? "dim" : ""}" onclick="openItem('${it.id}')">
      <div class="lrank">${typeof logoTile === "function" ? logoTile(it.opp, "jc-mono sm") : rank + 1}</div>
      <div class="lmain">
        <div class="ltitle">${esc(it.opp.title)}</div>
        <div class="lorg">${esc(it.opp.org)} · ${esc(it.opp.type || "opportunity")}${it.opp.yale_tie ? ` · <span class="lyt">${esc(it.opp.yale_tie)}</span>` : ""}</div>
        ${pplN ? `<div class="lnext">👤 ${reachN ? reachN + " of " + pplN + " people chosen" : pplN + " people to reach"}</div>` : ""}
        ${nextEv ? `<div class="lnext">${KIND_ICON[nextEv.kind] || "📍"} ${esc(nextEv.title)} · ${esc(fmtDate(nextEv.date))}</div>` : ""}
      </div>
      <div class="ldl ${urgent ? "urgent" : ""}">${d != null ? (d < 0 ? "Closed" : d === 0 ? "Due today" : `${d} days`) : "Rolling"}<small>${it.opp.deadline ? esc(fmtDate(it.opp.deadline)) : esc(it.opp.deadline_note || "no fixed deadline")}</small></div>
      <div class="lprog">${!it.detail ? `<span class="spin"></span> researching` : it.detail.error ? `<span class="why">${esc(it.detail.error)}</span>` : `<div class="track"><i style="width:${total ? (done / total) * 100 : 0}%;background:var(--green)"></i></div><small>${done}/${total} steps</small>`}</div>
      <div class="lstat"><span class="pill s-${it.status}">${STATUS_TEXT[it.status]}</span></div>
    </div>`;
  }).join("");
}

// ---------------- detail drawer ----------------
async function openItem(id) {
  const it = CART.items.find((i) => i.id === id);
  if (!it) return;
  CART.open = id;
  $("#item").hidden = false;
  paintItem(it);
}
function paintItem(it) {
  const D = it.detail;
  const done = new Set(stepsDone(it)), reach = reachSet(it);
  const gcal = (e) => {
    const start = e.date.replace(/-/g, ""); const end = new Date(e.date + "T12:00:00"); end.setDate(end.getDate() + 1);
<<<<<<< Updated upstream
    return "https://calendar.google.com/calendar/render?" + new URLSearchParams({ action: "TEMPLATE", text: `${KIND_ICON[e.kind] || ""} ${e.title}`, dates: `${start}/${end.toISOString().slice(0, 10).replace(/-/g, "")}`, details: [e.time, e.url, e.verified ? "" : "Confirm this date on the official page.", "— Bulldog Reach"].filter(Boolean).join("\n") });
=======
    return "https://calendar.google.com/calendar/render?" + new URLSearchParams({ action: "TEMPLATE", text: `${KIND_ICON[e.kind] || ""} ${e.title}`, dates: `${start}/${end.toISOString().slice(0, 10).replace(/-/g, "")}`, details: [e.time, e.url, "— Bulldog Reach"].filter(Boolean).join("\n") });
>>>>>>> Stashed changes
  };
  const events = [
    ...(it.opp.deadline ? [{ title: `Apply: ${it.opp.title}`, kind: "deadline", date: it.opp.deadline, url: it.opp.url, verified: true }] : []),
    ...((D?.events || []).filter((e) => !(e.kind === "deadline" && e.date === it.opp.deadline))),
  ].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  $("#itembody").innerHTML = `
    <div class="k">${esc(it.opp.type || "opportunity")} · ${esc(it.opp.org)}</div>
    <div class="row3" style="margin:6px 0 10px;flex-wrap:nowrap">${typeof logoTile === "function" ? logoTile(it.opp, "jc-mono lg") : ""}<h2 style="font-size:34px;line-height:1.05;margin:0">${esc(it.opp.title)}</h2></div>
    <div class="row3">
      <select class="track-sel s-${it.status}" onchange="setItem('${it.id}', {status:this.value})">${Object.entries(STATUS_TEXT).map(([k, v]) => `<option value="${k}" ${k === it.status ? "selected" : ""}>${v}</option>`).join("")}</select>
      ${it.opp.url ? `<a class="glassbtn smallbtn" href="${esc(it.opp.url)}" target="_blank" rel="noopener">Official page ↗</a>` : ""}
      <button class="calbtn" onclick="openTailor('${it.id}')">✨ Tailor my resume</button>
    </div>
<<<<<<< Updated upstream
    ${!D ? `<p class="loading"><i></i>Finding deadlines, info sessions and a checklist…</p>` : D.error ? `<p class="err">${esc(D.error)}</p>` : `
=======
    ${!D ? `<p class="loading"><i></i>Bulldog is finding the people, dates and a checklist…</p>` : D.error ? `<p class="err">${esc(D.error)}</p>` : `
>>>>>>> Stashed changes
    <p class="lede" style="font-size:16px;margin:18px 0 6px">${esc(D.summary)}</p>
    ${D.eligibility ? `<p class="why">Eligibility: ${esc(D.eligibility)}</p>` : ""}
    <h3 class="dh">People to reach <small class="why">${(D.people || []).length ? reach.size + " chosen" : ""}</small></h3>
    ${(D.people || []).length ? `<div class="ppl">${D.people.map((p, i) => `
      <div class="pp ${reach.has(p.id) ? "on" : ""}">
        <div class="pphead"><div class="ppav">${esc(initials(p.name))}</div>
          <div class="ppwho"><b>${esc(p.name)}</b><small>${esc(p.role)}</small></div>
          <button class="${reach.has(p.id) ? "whitebtn" : "glassbtn"} smallbtn" onclick="toggleReach('${it.id}','${esc(p.id)}')">${reach.has(p.id) ? "✓ Reaching out" : "+ Reach out"}</button></div>
        ${p.yale_tie ? `<div class="yt"><span>${esc(p.yale_tie)}</span></div>` : ""}
        <p class="why">${esc(p.why)}</p>
        ${reach.has(p.id) ? `<div class="subj">Subject: ${esc(p.subject)} · Ask: ${esc(p.ask)}</div><div class="msg" id="pm${i}">${esc(p.message)}</div>
        <div class="row3"><button class="whitebtn smallbtn" onclick="navigator.clipboard.writeText($('#pm${i}').textContent);this.textContent='Copied ✓'">Copy message</button>${p.url ? `<a class="glassbtn smallbtn" href="${esc(p.url)}" target="_blank" rel="noopener">Their page ↗</a>` : ""}</div>` : ""}
      </div>`).join("")}</div>` : `<button class="glassbtn smallbtn" onclick="refreshItem('${it.id}')">Find people for this one</button>`}
    <h3 class="dh">Dates</h3>
    <div class="evlist">${events.length ? events.map((e) => `
      <div class="ev"><span class="evk">${KIND_ICON[e.kind] || "📍"}</span>
        <div><b>${esc(e.title)}</b><small>${[e.date && esc(fmtDate(e.date)), e.time && esc(e.time)].filter(Boolean).join(" · ")}</small></div>
        ${e.date ? `<a class="calbtn smallbtn" href="${esc(gcal(e))}" target="_blank" rel="noopener">+ Calendar</a>` : e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener" class="smallbtn glassbtn">Details ↗</a>` : ""}
      </div>`).join("") : `<p class="why">No dates posted.</p>`}</div>
    <h3 class="dh">Checklist <small class="why">${done.size}/${(D.checklist || []).length}</small></h3>
    <div class="cl">${(D.checklist || []).map((c) => `<label class="task"><input type="checkbox" ${done.has(c.id) ? "checked" : ""} onchange="toggleStep('${it.id}','${esc(c.id)}',this.checked)"><span>${esc(c.text)}</span><em>${esc(c.kind)}</em></label>`).join("")}</div>
    <h3 class="dh">Do this week</h3>
    <ol class="na">${(D.next_actions || []).map((a) => `<li>${esc(a)}</li>`).join("")}</ol>
    ${(D.messages || []).length ? `<h3 class="dh">Suggested messages</h3>${D.messages.map((m, i) => `
      <div class="dm"><div class="subj">To: ${esc(m.to)} · ${esc(m.why)}</div><div class="subj">Subject: ${esc(m.subject)}</div>
        <div class="msg" id="dm${i}">${esc(m.body)}</div>
        <button class="whitebtn smallbtn" onclick="navigator.clipboard.writeText($('#dm${i}').textContent);this.textContent='Copied ✓'">Copy</button></div>`).join("")}` : ""}
    ${(D.keywords || []).length ? `<h3 class="dh">Keywords to reflect</h3><div class="yt">${D.keywords.map((k) => `<span>${esc(k)}</span>`).join("")}</div>` : ""}
    `}
    <div class="row3" style="margin-top:28px">
      <button class="linkbtn" onclick="refreshItem('${it.id}')">Refresh research</button>
      <button class="linkbtn" style="color:var(--red)" onclick="removeItem('${it.id}')">Remove from list</button>
    </div>`;
}
async function setItem(id, patch) {
  const { item } = await call("/api/cart/" + id, { method: "PATCH", body: patch });
  CART.items = CART.items.map((i) => (i.id === id ? item : i));
  renderCart(); if (CART.open === id) paintItem(item);
}
// One saved array holds both: finished checklist steps, and chosen people as "reach:<person id>".
const stepsDone = (it) => (it.done || []).filter((x) => !String(x).startsWith("reach:"));
const reachSet = (it) => new Set((it.done || []).filter((x) => String(x).startsWith("reach:")).map((x) => x.slice(6)));
function toggleStep(id, step, on) {
  const it = CART.items.find((i) => i.id === id);
  const done = new Set(it.done || []);
  on ? done.add(step) : done.delete(step);
  setItem(id, { done: [...done] });
}
function toggleReach(id, pid) {
  const it = CART.items.find((i) => i.id === id);
  const done = new Set(it.done || []), k = "reach:" + pid;
  done.has(k) ? done.delete(k) : done.add(k);
  setItem(id, { done: [...done] });
}
async function refreshItem(id) { await call(`/api/cart/${id}/refresh`, {}); CART.items = CART.items.map((i) => (i.id === id ? { ...i, detail: null } : i)); paintItem(CART.items.find((i) => i.id === id)); loadCart(); }
async function removeItem(id) {
  if (!confirmInline(id)) return;
  await call("/api/cart/" + id, { method: "DELETE" });
  CART.items = CART.items.filter((i) => i.id !== id);
  $("#item").hidden = true; renderCart();
}
// Two-click confirm without a browser dialog.
const _armed = {};
function confirmInline(id) {
  if (_armed[id]) return true;
  _armed[id] = true; toast("Click “Remove from list” again to confirm"); setTimeout(() => delete _armed[id], 4000);
  return false;
}

// Repaint the open drawer when polling brings new detail.
const _origRender = renderCart;
renderCart = function () { _origRender(); if (CART.open && !$("#item").hidden) { const it = CART.items.find((i) => i.id === CART.open); if (it) paintItem(it); } };

// ---------------- calendar subscription ----------------
async function openCalendar() {
  $("#calmodal").hidden = false;
  if (!CART.cal) CART.cal = await call("/api/calendar", { method: "GET" });
  const c = CART.cal;
  $("#calbody").innerHTML = `
    <p class="lede" style="font-size:16px">Subscribe once. Every deadline, info session and office hour for opportunities on your list shows up in your calendar automatically — including ones you add later.</p>
    <div class="row3" style="margin:18px 0">
      ${c.publicHost ? `<a class="cta" style="width:auto;height:56px;padding:0 24px;font-size:17px;border-radius:16px" href="${esc(c.google)}" target="_blank" rel="noopener">Add to Google Calendar</a>
      <a class="glassbtn smallbtn" href="${esc(c.webcal)}">Apple / Outlook</a>` : ""}
      <a class="glassbtn smallbtn" href="${esc(c.feed)}" download="bulldog-reach.ics">Download .ics</a>
    </div>
    <p class="why">Private feed URL (don't share it): <code style="user-select:all">${esc(c.feed)}</code></p>
    <p class="why">Google refreshes subscribed calendars every few hours, so brand-new items can take a bit to appear.</p>`;
}

// ---------------- tiny toast ----------------
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 3200);
}
