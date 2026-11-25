// Shared app logic: auth, API calls, swipe deck, game plan rendering, history, calendar helpers.
// Loaded by app.html (before cart.js, resume.js, app.js).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const oddsColor = (n) => (n >= 65 ? "var(--green)" : n >= 45 ? "var(--yellow)" : "var(--red)");
const initials = (n) => String(n || "?").replace(/\(.*?\)/g, "").replace(/^(Prof\.|Dr\.)\s*/, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
let lastPeople = [];
// A name is shown as a name: drop any bracketed how-to-find note (older saved plans have them).
const pname = (p) => String(p.name || "").replace(/\s*\((?!example)[^)]*\)/g, "").trim();

// ---------------- auth (beta) ----------------
const AUTH = { on: false, sb: null, session: null, domain: "yale.edu", limits: {} };
const token = () => AUTH.session?.access_token;

async function boot() {
  const cfg = await fetch("/api/config").then((r) => r.json());
  const el = $("#status");
  AUTH.ai = !!cfg.ai;
  el.hidden = cfg.ai; el.innerHTML = cfg.demo ? "<i></i>sample data (fake)" : "<i></i>AI off";
  if (!el.hidden) el.title = cfg.demo ? "DEMO_MODE=1: everything the AI would return is made up" : "AI chat needs a paid Anthropic API key. The Workspace is free.";
  AUTH.on = cfg.auth; AUTH.emailCode = !!cfg.emailCode; AUTH.domain = cfg.domain; AUTH.limits = cfg.limits || {};
  if (!AUTH.on) return paintAuth();
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  AUTH.sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "implicit" } });
  AUTH.sb.auth.onAuthStateChange((_e, session) => { AUTH.session = session; paintAuth(); });
  // Email button lands on /auth/confirm?token_hash=…&type=email — verify it here and sign in, in ANY browser.
  const q = new URLSearchParams(location.search);
  if (location.pathname === "/auth/confirm" && q.get("token_hash")) {
    $("#authbox").hidden = false; $("#f").hidden = true;
    $("#authstep").innerHTML = `<p class="loading" style="padding:0"><i></i>Signing you in…</p>`;
    $("#build")?.scrollIntoView();
    const { error } = await AUTH.sb.auth.verifyOtp({ token_hash: q.get("token_hash"), type: q.get("type") || "email" });
    history.replaceState(null, "", "/");
    if (error) showEmailStep(`That link expired or was already used (${error.message}). Enter your email to get a new one.`);
  }
  const { data } = await AUTH.sb.auth.getSession();
  AUTH.session = data.session;
  paintAuth();
  if (location.pathname === "/auth/confirm" || location.hash.includes("access_token")) history.replaceState(null, "", "/");
}
window.addEventListener("DOMContentLoaded", boot);

function paintAuth() {
  const signedIn = !AUTH.on || !!AUTH.session;
  $("#authbox").hidden = signedIn;
  $("#f").hidden = !signedIn;
  const email = AUTH.session?.user?.email;
  $("#me").innerHTML = AUTH.on && email
    ? `<button class="glassbtn mebtn" onclick="openHistory()">My plans</button><span class="meemail">${esc(email)}</span><button class="linkbtn" style="font-size:14px" onclick="signOut()">Sign out</button>`
    : AUTH.on ? `<a href="#build" class="glassbtn mebtn" style="text-decoration:none">Sign in</a>` : "";
  if (AUTH.on && email) loadHistory();
  if (signedIn) { loadCart(); loadResume(); }
}

// Step 1: email → Supabase sends our branded email with a 6-digit code + a sign-in button.
function showEmailStep(msg) {
  $("#authstep").innerHTML = `
    <form id="authform" class="authform" onsubmit="sendCode(event)">
      <input id="email" type="email" placeholder="you@yale.edu" autocomplete="email" required value="${esc(AUTH.pendingEmail || "")}" />
      <button class="cta" id="authbtn">Send my code →</button>
    </form>`;
  $("#autherr").textContent = msg || "";
}
async function sendCode(e) {
  e.preventDefault();
  const email = $("#email").value.trim().toLowerCase();
  if (!email.endsWith("@" + AUTH.domain) && !email.endsWith("." + AUTH.domain)) return ($("#autherr").textContent = `Use your @${AUTH.domain} email.`);
  $("#autherr").textContent = "";
  $("#authbtn").disabled = true; $("#authbtn").textContent = "Sending…";
  const { error } = await AUTH.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + "/auth/confirm" } });
  if (error) { $("#authbtn").disabled = false; $("#authbtn").textContent = "Send my code →"; return ($("#autherr").textContent = /rate|seconds/i.test(error.message) ? "Too many emails just now — wait a minute and try again." : error.message); }
  AUTH.pendingEmail = email;
  showCodeStep();
}
// Step 2: type the code from the email → signed in right here (no tab switching).
function showCodeStep() {
  if (!AUTH.emailCode) {
    // Default Supabase email = link only. Opening it (any tab on this computer) signs this tab in too.
    $("#authstep").innerHTML = `
      <p class="lede" style="font-size:16px;margin:0 0 6px">📬 We emailed a sign-in link to <b style="color:#fff">${esc(AUTH.pendingEmail)}</b>.</p>
      <p class="loading" style="padding:6px 0 0"><i></i>Open it on this computer — this page signs you in automatically.</p>
      <div class="row3" style="margin-top:12px"><button class="linkbtn" style="font-size:14px" onclick="showEmailStep()">Use a different email</button><button class="linkbtn" style="font-size:14px" onclick="resendCode(this)">Resend email</button></div>`;
    return;
  }
  $("#authstep").innerHTML = `
    <p class="lede" style="font-size:16px;margin:0 0 14px">We emailed a code to <b style="color:#fff">${esc(AUTH.pendingEmail)}</b>. Type it here — or tap “Sign in” in the email.</p>
    <form class="authform" onsubmit="verifyCode(event)">
      <input id="otp" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="••••••" required />
      <button class="cta" id="otpbtn">Sign in →</button>
    </form>
    <div class="row3" style="margin-top:12px"><button class="linkbtn" style="font-size:14px" onclick="showEmailStep()">Use a different email</button><button class="linkbtn" style="font-size:14px" onclick="resendCode(this)">Resend code</button></div>`;
  $("#otp").focus();
  $("#otp").oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, ""); if (e.target.value.length >= 6 && e.target.value.length === (AUTH.codeLen || 6)) e.target.form.requestSubmit(); };
}
async function verifyCode(e) {
  e.preventDefault();
  const token = $("#otp").value.replace(/\D/g, "");
  $("#otpbtn").disabled = true; $("#otpbtn").textContent = "Checking…";
  const { error } = await AUTH.sb.auth.verifyOtp({ email: AUTH.pendingEmail, token, type: "email" });
  if (error) { $("#otpbtn").disabled = false; $("#otpbtn").textContent = "Sign in →"; $("#autherr").textContent = "That code didn't work — check the newest email, or resend."; return; }
  $("#autherr").textContent = "";
  toast("You're in. Welcome to Bulldog Reach 👋");
}
async function resendCode(btn) {
  btn.disabled = true;
  const { error } = await AUTH.sb.auth.signInWithOtp({ email: AUTH.pendingEmail, options: { shouldCreateUser: true, emailRedirectTo: location.origin + "/auth/confirm" } });
  $("#autherr").textContent = error ? (/rate|seconds/i.test(error.message) ? "Wait a minute before resending." : error.message) : "";
  if (!error) toast("New code sent");
  setTimeout(() => (btn.disabled = false), 30000);
}
async function signOut() { await AUTH.sb.auth.signOut(); location.reload(); }

document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => ($("#goal").value = c.textContent)));
$("#about").value = localStorage.bb_about || "";

// ---------------- state ----------------
const S = { goal: "", deck: [], liked: [], seen: [], plan: null, outreach: {} };
async function call(path, { method = "POST", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token()) headers.Authorization = "Bearer " + token();
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && AUTH.on) { AUTH.session = null; paintAuth(); $("#build") && window.scrollTo({ top: $("#build").offsetTop }); }
  if (!r.ok) throw Object.assign(new Error(d.error || "Something broke"), { status: r.status });
  if (d._usage) paintUsage(d._usage);
  return d;
}
const api = (path, body) => call(path, { body });
function paintUsage(u) { $("#usage").textContent = `${u.used}/${u.limit} today`; }

// ---------------- history + tracker ----------------
async function loadHistory() {
  try {
    const { plans } = await call("/api/plans", { method: "GET" });
    $("#histlist").innerHTML = plans.length
      ? plans.map((p) => `<button class="hrow" onclick="openPlan('${esc(p.id)}')"><b>${esc(p.goal)}</b><span>${esc(p.north_star || "")}</span><small>${new Date(p.created_at).toLocaleDateString()}</small></button>`).join("")
      : `<p class="why">No saved plans yet. Your plans save automatically.</p>`;
  } catch {}
}
function openHistory() { $("#history").hidden = false; loadHistory(); }
async function openPlan(id) {
  $("#history").hidden = true;
  try {
    const row = await call("/api/plans/" + id, { method: "GET" });
    const d = row.data; d._id = row.id; d._liked = row.liked || [];
    S.outreach = Object.fromEntries((row.outreach || []).map((o) => [o.person, o.status]));
    S.goal = row.goal; $("#goal").value = row.goal;
    render(d, row.goal);
    window.scrollTo({ top: $("#out").offsetTop - 10 });
  } catch (e) { alert(e.message); }
}
const STATUS_LABELS = { todo: "To send", sent: "Sent", replied: "Replied 🎉", meeting: "Meeting booked", referred: "Referred ⭐", no_reply: "No reply" };
async function setStatus(person, sel) {
  S.outreach[person] = sel.value;
  sel.className = "track-sel s-" + sel.value;
  paintTracker();
  if (!S.plan?._id) return; // not saved (local mode) — keep in memory only
  try { await call("/api/outreach", { body: { plan_id: S.plan._id, person, status: sel.value } }); }
  catch (e) { sel.title = "Not saved: " + e.message; }
}
function paintTracker() {
  const vals = Object.values(S.outreach);
  const n = (s) => vals.filter((v) => v === s).length;
  const el = $("#tracksum");
  if (el) el.textContent = `${n("sent") + n("replied") + n("meeting") + n("referred")} sent · ${n("replied") + n("meeting") + n("referred")} replied · ${n("meeting")} meetings · ${n("referred")} referrals`;
}
const readGoal = () => {
  const goal = $("#goal").value.trim();
  if (!goal) { $("#err").textContent = "Tell us your goal first."; return null; }
  localStorage.bb_about = $("#about").value;
  $("#err").textContent = "";
  if (goal !== S.goal) { S.goal = goal; S.liked = []; S.seen = []; S.deck = []; }
  return goal;
};

// Step 1 → find opportunities (swipe deck)
$("#f").onsubmit = async (e) => {
  e.preventDefault();
  if (!readGoal()) return;
  await loadDeck();
};
$("#skip").onclick = () => { if (readGoal()) buildPlan(); };
$("#more").onclick = () => loadDeck();
$("#planbtn").onclick = () => buildPlan();

async function loadDeck() {
  $("#btn").disabled = $("#more").disabled = true;
  $("#deck").hidden = false;
  $("#stack").innerHTML = [0, 1, 2].map((i) => `<div class="jc skel" style="--i:${i}"><i></i><i></i><i></i><i></i><i></i></div>`).reverse().join("");
  renderLikes();
  window.scrollTo({ top: $("#deck").offsetTop, behavior: "smooth" });
  try {
    const d = await api("/api/opportunities", { goal: S.goal, about: $("#about").value, seen: S.seen });
    const fresh = (d.opportunities || []).filter((o) => o && o.title && !S.seen.includes(o.title));
    fresh.forEach((o) => {
      S.seen.push(o.title);
      // Never put a past deadline on the calendar: search sometimes returns last cycle's date.
      if (o.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(o.deadline) || o.deadline < new Date().toISOString().slice(0, 10))) {
        o.deadline_note = /^\d{4}/.test(o.deadline) ? "Reopens next cycle" : o.deadline_note || "Rolling";
        o.deadline = null;
      }
    });
    S.deck = fresh.sort((a, b) => (b.fit || 0) - (a.fit || 0));
    renderDeck();
  } catch (err) {
    $("#stack").innerHTML = `<div class="empty">Couldn’t load opportunities (${esc(err.message.slice(0, 80))}).<br/>You can still build your plan.</div>`;
  } finally {
    $("#btn").disabled = $("#more").disabled = false;
  }
}

const TYPE_COLORS = { internship: "#7A4A22", job: "#2E4A6B", research: "#3E5A3A", fellowship: "#6B3A55", program: "#5A4A22" };
const fmtDate = (iso) => { if (!iso) return ""; const d = new Date(iso + "T12:00:00"); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };

const daysUntilIso = (iso) => (iso ? Math.ceil((new Date(iso + "T23:59:00") - new Date()) / 864e5) : null);
// Official logos: the org's own domain (never a job board) → its site icon at high resolution.
const JOB_BOARDS = /(^|\.)(greenhouse|lever|workday|myworkdayjobs|linkedin|joinhandshake|handshake|symplicity|indeed|glassdoor|ashbyhq|smartrecruiters|icims|wellfound|ycombinator|communityforce|terradotta)\./i;
function logoDomain(o) {
  let fromUrl = ""; try { fromUrl = new URL(o.url).hostname; } catch {}
  for (let d of [o.domain, fromUrl]) {
    d = String(d || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && !JOB_BOARDS.test(d + ".")) return d.replace(/^(careers|jobs|apply|boards)\./, "");
  }
  return "";
}
const logoUrl = (o) => { const d = logoDomain(o); return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128` : ""; };
// Logo tile with a letter monogram underneath; if the logo fails to load, the monogram shows.
const logoTile = (o, cls = "jc-mono") => `<b class="${cls}" style="background:${monoColor(o.org)}">${esc(String(o.org || "?").trim()[0] || "?")}${logoUrl(o) ? `<img src="${esc(logoUrl(o))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ""}</b>`;
const MONO_COLORS = ["#111111", "#2E4A6B", "#3E5A3A", "#6B3A55", "#7A4A22", "#1F5E5B"];
const monoColor = (s) => MONO_COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % MONO_COLORS.length];

// Job card (design: Figma "Job cards · motion" → JobCard). Fanned stack, top card last.
function renderDeck() {
  const stack = $("#stack");
  if (!S.deck.length) {
    stack.innerHTML = `<div class="empty"><div>No more cards.<br/><b style="color:#fff">${S.liked.length} saved.</b><br/><br/>Build your plan, or load more.</div></div>`;
    return;
  }
  const deal = !S._dealt; S._dealt = true; // cards "deal in" only when a new batch arrives
  stack.innerHTML = S.deck.slice(0, 3).map((o, i) => {
    const d = daysUntilIso(o.deadline), fit = Math.max(0, Math.min(100, +o.fit || 0));
    return `
    <div class="jc ${deal ? "deal" : ""}" data-i="${i}" style="--i:${i};--p:${fit}">
      <div class="jc-wash"></div>
      <span class="stamp y">SAVE</span><span class="stamp n">PASS</span>
      <div class="jc-top">
        <div class="jc-org">${logoTile(o)}
          <div><div class="jc-orgname">${esc(o.org)}</div><div class="jc-meta">${esc([o.location, o.type].filter(Boolean).join(" · "))}</div></div></div>
        <div class="ring"><svg viewBox="0 0 52 52"><circle class="rbg" cx="26" cy="26" r="22"/><circle class="rfg" cx="26" cy="26" r="22"/></svg><span><b data-count="${fit}">${fit}</b>%</span></div>
      </div>
      <h3>${esc(o.title)}</h3>
      ${o.pitch ? `<p class="jc-pitch">${esc(o.pitch)}</p>` : ""}
      <div class="jc-chips">
        <span class="c-dl ${d != null && d <= 14 ? "soon" : ""}">${d != null ? `Due in ${d} day${d === 1 ? "" : "s"}` : esc(o.deadline_note || "Rolling deadline")}</span>
        ${o.yale_tie ? `<span class="c-yt">${esc(o.yale_tie)}</span>` : ""}
      </div>
      <div class="jc-stats">
        <div><b ${d != null ? `data-count="${d}"` : ""}>${d != null ? d : "—"}</b><small>days left</small></div>
        <div><b>${o.deadline ? esc(fmtDate(o.deadline).replace(/, \d{4}$/, "")) : "Rolling"}</b><small>deadline</small></div>
        <div><b>${esc((o.location || "—").split(/[,(]/)[0].slice(0, 14))}</b><small>location</small></div>
      </div>
    </div>`;
  }).reverse().join("");
  const top = stack.querySelector('.jc[data-i="0"]');
  requestAnimationFrame(() => requestAnimationFrame(() => { top?.classList.add("in"); countUp(top); }));
  attachDrag(top);
}

// Numbers count up from 0 when a card comes to the top.
function countUp(root) {
  if (!root || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll("[data-count]").forEach((el) => {
    const to = +el.dataset.count, t0 = performance.now(), dur = 700;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

function attachDrag(card) {
  if (!card) return;
  let x0 = 0, y0 = 0, dx = 0, dy = 0, down = false;
  const y = card.querySelector(".stamp.y"), n = card.querySelector(".stamp.n"), wash = card.querySelector(".jc-wash");
  const next = card.parentElement.querySelector('.jc[data-i="1"]');
  card.onpointerdown = (e) => { down = true; x0 = e.clientX; y0 = e.clientY; card.setPointerCapture(e.pointerId); card.classList.add("drag"); };
  card.onpointermove = (e) => {
    if (!down) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    const k = Math.min(1, Math.abs(dx) / 140);
    card.style.transform = `translate(${dx}px,${dy * 0.4}px) rotate(${dx / 16}deg)`;
    y.style.opacity = dx > 0 ? k : 0; n.style.opacity = dx < 0 ? k : 0;
    wash.style.background = dx > 0 ? `rgba(34,179,94,${0.28 * k})` : `rgba(255,90,71,${0.28 * k})`;
    if (next) next.style.transform = `translateY(${14 - 14 * k}px) scale(${0.96 + 0.04 * k})`; // next card rises as you drag
  };
  card.onpointerup = () => {
    if (!down) return;
    down = false; card.classList.remove("drag");
    if (Math.abs(dx) > 110) swipe(dx > 0);
    else { card.style.transform = ""; y.style.opacity = n.style.opacity = 0; wash.style.background = ""; if (next) next.style.transform = ""; }
    dx = dy = 0;
  };
}

function swipe(like) {
  const card = $('#stack .jc[data-i="0"]');
  if (!card || !S.deck.length || card.classList.contains("gone")) return;
  const o = S.deck.shift();
  card.classList.add("gone");
  card.querySelector(like ? ".stamp.y" : ".stamp.n").style.opacity = 1;
  card.querySelector(".jc-wash").style.background = like ? "rgba(34,179,94,.28)" : "rgba(255,90,71,.28)";
  let wait = 300;
  if (like) {
    S.liked.push(o); addToCart(o);
    // Saved: shrink and fly into "My list" (sidebar), then bump its badge.
    const target = document.querySelector("#mylistbtn") || document.querySelector("#cartcount");
    if (target && target.offsetParent) {
      const a = card.getBoundingClientRect(), b = target.getBoundingClientRect();
      const tx = b.left + b.width / 2 - (a.left + a.width / 2), ty = b.top + b.height / 2 - (a.top + a.height / 2);
      card.style.transition = "transform .6s cubic-bezier(.5,-0.2,.3,1), opacity .6s ease .1s";
      card.style.transform = `translate(${tx}px,${ty}px) scale(.12) rotate(-12deg)`;
      card.style.opacity = 0.2;
      wait = 560;
      setTimeout(() => { const bd = $("#cartcount"); bd?.classList.remove("bump"); void bd?.offsetWidth; bd?.classList.add("bump"); }, 520);
    } else { card.style.transform = "translate(640px,-40px) rotate(28deg)"; card.style.opacity = 0; }
  } else {
    card.style.transform = "translate(-640px,40px) rotate(-28deg)"; card.style.opacity = 0;
  }
  renderLikes();
  setTimeout(renderDeck, wait);
}
$("#yesbtn").onclick = () => swipe(true);
$("#nobtn").onclick = () => swipe(false);
document.addEventListener("keydown", (e) => {
  if ($("#deck").hidden || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === "ArrowRight") swipe(true);
  if (e.key === "ArrowLeft") swipe(false);
});

function renderLikes() {
  $("#likes").innerHTML = S.liked.map((o) => `<div>${esc(o.title)} · ${esc(o.org)}<span>${o.deadline ? "Due " + esc(fmtDate(o.deadline)) : "Rolling"}</span></div>`).join("");
  $("#planbtn").disabled = false;
  $("#planbtn").textContent = S.liked.length ? `Build my plan for ${S.liked.length} pick${S.liked.length > 1 ? "s" : ""} →` : "Build my plan →";
}

// Step 3 → game plan
async function buildPlan() {
  const goal = S.goal;
  $("#btn").disabled = $("#planbtn").disabled = true;
  const stop = showProgress();
  try {
    const d = await api("/api/plan", { goal, about: $("#about").value, profiles: $("#profiles").value, liked: S.liked });
    stop();
    d._liked = S.liked;
    S.outreach = {};
    if (AUTH.on) loadHistory();
    try { localStorage.bb_last = JSON.stringify({ d, goal }); } catch {}
    render(d, goal);
  } catch (err) {
    stop();
    const last = (() => { try { return JSON.parse(localStorage.bb_last || "null"); } catch { return null; } })();
    if (last) render(last.d, last.goal, `Bulldog couldn’t finish that one. Showing your last plan.`);
    else { $("#out").innerHTML = ""; $("#err").textContent = err.message; }
  } finally {
    $("#btn").disabled = $("#planbtn").disabled = false;
  }
}

function showProgress() {
  const steps = ["Turning your goal into a north star", "Finding the people behind your picks", "Searching the web for Yale ties", "Ranking people by fit × reply odds", "Drafting one message per person"];
  const at = [0, 2, 6, 10, 14]; // seconds each step lights up
  $("#out").innerHTML = `<div class="wrap prog">
    <div class="k">Bulldog · live search</div>
    <h2>Building your game plan <span id="tick">0s</span></h2>
    <ul class="plist">${steps.map((s) => `<li><b></b>${esc(s)}</li>`).join("")}</ul></div>`;
  window.scrollTo({ top: $("#out").offsetTop - 20, behavior: "smooth" });
  const t0 = Date.now();
  const lis = [...document.querySelectorAll(".plist li")];
  const tick = () => {
    const s = (Date.now() - t0) / 1000;
    $("#tick") && ($("#tick").textContent = Math.floor(s) + "s");
    let cur = 0; at.forEach((a, i) => { if (s >= a) cur = i; });
    lis.forEach((li, i) => { li.className = i < cur ? "done" : i === cur ? "on" : ""; li.firstChild.textContent = i < cur ? "✓" : ""; });
  };
  tick();
  const id = setInterval(tick, 250);
  return () => clearInterval(id);
}

// ---------------- calendar ----------------
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const icsEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
function eventsForPlan(d) {
  const ev = [];
  (d._liked || []).forEach((o) => {
    if (!o.deadline) return;
    const day = new Date(o.deadline + "T12:00:00");
    if (isNaN(day)) return;
    ev.push({ id: "dl-" + o.title, title: `⏰ Apply: ${o.title} @ ${o.org}`, date: day, details: `${o.pitch || ""}\n${o.url || ""}\n— Bulldog Reach`, alarmDays: 3 });
  });
  (d.people || []).forEach((p) => {
    const day = addDays(new Date(), +p.follow_up_days || 5);
    ev.push({ id: "fu-" + p.name, title: `Follow up: ${String(p.name).replace(/\(.*?\)/g, "").trim()}`, date: day, details: `If no reply: ${p.follow_up || ""}\n\nOriginal ask: ${p.ask || ""}\n— Bulldog Reach`, alarmDays: 0 });
  });
  return ev;
}
function ics(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const body = events.map((e) => [
    "BEGIN:VEVENT",
    `UID:${Math.random().toString(36).slice(2)}@bulldogreach`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(e.date)}`,
    `DTEND;VALUE=DATE:${ymd(addDays(e.date, 1))}`,
    `SUMMARY:${icsEsc(e.title)}`,
    `DESCRIPTION:${icsEsc(e.details)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(e.title)}`, e.alarmDays ? `TRIGGER:-P${e.alarmDays}D` : "TRIGGER:-PT0M", "END:VALARM",
    "END:VEVENT",
  ].join("\r\n")).join("\r\n");
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Bulldog Reach//EN\r\nCALSCALE:GREGORIAN\r\n${body}\r\nEND:VCALENDAR\r\n`;
}
function downloadICS(events, name) {
  const blob = new Blob([ics(events)], { type: "text/calendar" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}
function gcal(e) {
  const p = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${ymd(e.date)}/${ymd(addDays(e.date, 1))}`, details: e.details });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}
function addCal(id, btn) {
  const e = eventsForPlan(S.plan).find((x) => x.id === id);
  if (!e) return;
  window.open(gcal(e), "_blank");
  btn.classList.add("added"); btn.textContent = "✓ On calendar";
}
function addAllCal() {
  const evs = eventsForPlan(S.plan);
  if (evs.length) downloadICS(evs, "bulldog-reach-plan.ics");
}
const linkify = (src) => {
  const m = String(src || "").match(/https?:\/\/[^\s)]+/);
  if (!m) return esc(src);
  const host = m[0].replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  const label = String(src).replace(m[0], "").replace(/[()]/g, "").trim() || host;
  return `<a href="${esc(m[0])}" target="_blank" rel="noopener">${esc(label.slice(0, 40))} ↗</a>`;
};

function render(d, goal, warning) {
  const people = (d.people || []).sort((a, b) => b.fit_score * b.reply_likelihood - a.fit_score * a.reply_likelihood);
  lastPeople = people;
  S.plan = d;
  const live = d._meta && !d._meta.demo;
  $("#out").innerHTML = `<div class="wrap">
    ${warning ? `<div class="banner">${esc(warning)}</div>` : ""}
    <div class="rtop">
      <div class="goalpill"><span>Goal</span>${esc(goal)}</div>
      <span class="status ${live ? "live" : ""}"><i></i>${live ? "Bulldog" + (d._meta.live_search ? " · live search" : "") : "demo data"}</span>
    </div>
    <div class="north"><div class="k">North star</div><div class="v">${esc(d.north_star)}</div></div>
    <div class="steps">${(d.game_plan || []).map((s, i) => `
      <div class="step ${i === 0 ? "on" : ""}">
        <div class="n">${esc(String(s.step).padStart(2, "0"))}${i === 0 ? "  ·  you are here" : ""}</div>
        <h3>${esc(s.title)}</h3><p>${esc(s.who)}</p><p>Ask → ${esc(s.ask)}</p>
      </div>`).join("")}
    </div>
    <div class="sh"><h2>Who to reach, ranked.</h2><small id="tracksum" class="tracksum">Sorted by goal fit × reply odds</small></div>
    <div class="people">${people.map((p, i) => `
      <div class="pc">
        <div class="hook">
          <div class="t"><div class="av">${esc(initials(pname(p)))}${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</div><span class="tag">#${i + 1} · Step ${esc(p.step)}</span></div>
          <div class="by">${esc(pname(p))} <span>${linkify(p.hook_source)}</span></div>
          ${p.hook ? `<q>${esc(p.hook)}</q>` : ""}
        </div>
        <div class="who">
          <div class="name">${esc(pname(p))}</div>
          <div class="head">${esc(p.headline)}</div>
          <div class="yt">${(p.yale_ties || []).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
          <div class="meter"><div class="r">GOAL FIT <b>${esc(p.fit_score)}</b></div><div class="track"><i style="width:${+p.fit_score || 0}%;background:var(--amber)"></i></div></div>
          <div class="meter"><div class="r">REPLY ODDS <b>${esc(p.reply_likelihood)}%</b></div><div class="track"><i style="width:${+p.reply_likelihood || 0}%;background:${oddsColor(+p.reply_likelihood)}"></i></div></div>
          <div class="why">${esc(p.likelihood_reason)}</div>
        </div>
        <div class="draft">
          <div class="subj">Subject: ${esc(p.subject)} · Ask: ${esc(p.ask)}</div>
          <div class="msg" id="m${i}">${esc(p.message)}</div>
          <div class="acts">
            <select class="track-sel s-${esc(S.outreach[p.name] || "todo")}" onchange="setStatus(lastPeople[${i}].name, this)" aria-label="Outreach status">
              ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${(S.outreach[p.name] || "todo") === k ? "selected" : ""}>${v}</option>`).join("")}
            </select>
            <button class="whitebtn" onclick="copy(${i}, this)">Copy message</button>
            <button class="glassbtn" onclick="openLinkedIn(${i})">${p.linkedin_url ? "Open LinkedIn" : p.url ? "Open their page" : "Find on LinkedIn"}</button>
            <button class="calbtn" onclick="addCal(${esc(JSON.stringify("fu-" + p.name))}, this)">📅 Follow-up in ${+p.follow_up_days || 5}d</button>
          </div>
          <div class="fu">No reply in ${+p.follow_up_days || 5} days → ${esc(p.follow_up)}</div>
        </div>
      </div>`).join("")}
    </div>
    ${(d._liked || []).length ? `
    <div class="sh"><h2>Your picks &amp; deadlines.</h2><small>From your swipes</small></div>
    <div class="shortlist">${d._liked.map((o) => `
      <div class="sl">
        <b>${esc(o.title)}</b>
        <div class="o">${esc(o.org)} · ${esc(o.type)}</div>
        <div class="d">${o.deadline ? "Due " + esc(fmtDate(o.deadline)) : esc(o.deadline_note || "Rolling")}</div>
        <div class="row2">
          ${o.deadline ? `<button class="calbtn" onclick="addCal(${esc(JSON.stringify("dl-" + o.title))}, this)">📅 Add deadline</button>` : ""}
          ${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener" style="align-self:center">Apply ↗</a>` : ""}
        </div>
      </div>`).join("")}
    </div>` : ""}
    <div class="sh"><h2>This week.</h2>
      <div class="allcal"><small>${eventsForPlan(d).length} reminders</small><button class="cta" style="width:auto;height:52px;padding:0 22px;font-size:16px;border-radius:14px" onclick="addAllCal()">📅 Add all to calendar (.ics)</button></div>
    </div>
    <div class="week">${(d.this_week || []).map((t) => `<label class="task"><input type="checkbox"><span>${esc(t)}</span></label>`).join("")}</div>
    <div class="meta">${[!live && "Demo data", d._id && "Saved to My plans"].filter(Boolean).join(" · ")}</div>
  </div>`;
  if (Object.keys(S.outreach).length) paintTracker();
}

function openLinkedIn(i) {
  const p = lastPeople[i] || {};
  const name = String(p.name || "").replace(/\(.*?\)/g, "").trim();
  window.open(p.linkedin_url || p.url || "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(name + " Yale"), "_blank", "noopener");
}
function copy(i, btn) {
  navigator.clipboard.writeText($("#m" + i).textContent);
  btn.textContent = "Copied ✓";
  setTimeout(() => (btn.textContent = "Copy message"), 1400);
}
