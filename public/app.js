// App shell: onboarding (email → LinkedIn → resume → about you → summer goal) and a ChatGPT-style chat.
// Reuses core.js (auth, deck, plan), cart.js (list, calendar) and resume.js (resume) by overriding a few hooks.
const APP = { profile: null, steps: ["email", "linkedin", "resume", "about", "goal"], step: "email", booted: false, answers: {}, returnToApp: false };

// ---------------- auth → onboarding or app ----------------
paintAuth = function () {
  const signedIn = !AUTH.on || !!AUTH.session;
  const email = AUTH.session?.user?.email;
  $("#me").innerHTML = AUTH.on && email ? `<span class="meemail">${esc(email)}</span><button class="linkbtn" style="font-size:13px" onclick="signOut()">Sign out</button>` : "";
  if (!signedIn) { APP.booted = false; return showOnboarding("email"); }
  if (APP.booted) return;
  APP.booted = true;
  enterApp();
};

async function enterApp() {
  try { const { profile } = await call("/api/profile", { method: "GET" }); APP.profile = profile; } catch { APP.profile = null; }
  loadResume(); loadCart(); loadHistory();
  if (!APP.profile?.onboarded) return showOnboarding("linkedin");
  setAbout();
  showShell();
  newChat();
}

// ---------------- onboarding ----------------
function visibleSteps() { return AUTH.on ? APP.steps : APP.steps.filter((s) => s !== "email"); }
function showOnboarding(step) {
  APP.step = step;
  $("#shell").hidden = true; $("#onb").hidden = false;
  document.querySelectorAll(".ostep").forEach((s) => (s.hidden = s.dataset.step !== step));
  const vs = visibleSteps(), i = vs.indexOf(step);
  $("#dots").innerHTML = vs.map((_, j) => `<i class="${j <= i ? "on" : ""}"></i>`).join("");
  document.querySelectorAll(".ostep .k").forEach((k) => { const st = k.closest(".ostep").dataset.step; const n = vs.indexOf(st); if (st !== "email" && st !== "goal") k.textContent = `Step ${n + 1} of ${vs.length}`; });
  if (step === "linkedin" && APP.profile?.linkedin_url) $("#o_lurl").value ||= APP.profile.linkedin_url;
  if (step === "about") { prefillChips(); paintSummary(); }
  if (step === "goal") { paintSuggestions(); $("#o_goal").value ||= APP.profile?.summer_goal || ""; $("#o_people").value ||= APP.profile?.people || ""; setTimeout(() => $("#o_goal").focus(), 50); }
  window.scrollTo(0, 0);
}
function go(delta) {
  const vs = visibleSteps();
  const next = vs[Math.max(0, Math.min(vs.length - 1, vs.indexOf(APP.step) + delta))];
  if (next === "email" && AUTH.session) return; // already signed in
  showOnboarding(next);
}


function linkedinContinue() {
  let u = $("#o_lurl").value.trim();
  if (u && !/linkedin\.com\/in\/[^\s/]+/i.test(u)) return ($("#o_lerr").textContent = "Use your profile link, like linkedin.com/in/your-name.");
  if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
  $("#o_lerr").textContent = ""; $("#o_lurl").value = u;
  go(1);
}

// Resume is read in the background as soon as it's chosen, so the student keeps answering questions.
async function parseInBackground() {
  const rf = $("#o_rfile").files[0];
  const key = rf && rf.name + ":" + rf.size;
  if (!rf || RS.parsing || RS.parsedKey === key) return RS.parsing;
  $("#o_rerr").textContent = ""; $("#o_rnote").textContent = "Reading your resume in the background…";
  RS.parsing = (async () => {
    try {
      const resume_text = await extractText(rf);
      const { resume } = await call("/api/resume/parse", { body: { resume_text, linkedin_url: $("#o_lurl").value.trim(), source_names: [rf.name] } });
      RS.resume = resume; RS.parsedKey = key; paintOnboarding(); paintSummary();
      $("#o_rnote").textContent = `✓ Read: ${resume.base.experience.length} experiences, ${resume.base.education.length} schools`;
    } catch (e) { $("#o_rnote").textContent = ""; $("#o_rerr").textContent = "Couldn’t read your resume: " + e.message; }
    finally { RS.parsing = null; }
  })();
  return RS.parsing;
}
async function parseAndContinue() {
  if (!$("#o_rfile").files[0]) return afterResume();
  const p = parseInBackground();
  if (APP.returnToApp) { $("#o_rbtn").disabled = true; await p; $("#o_rbtn").disabled = false; } // re-upload from the app: wait, then open it
  if (!$("#o_rerr").textContent) afterResume();
}
// resume.js (Alwis's version) asks for the onboarding wizard by this name.
function openWiz(step) { $("#rw").hidden = true; APP.returnToApp = true; showOnboarding(step === "resume" ? "resume" : step); }
function afterResume() {
  if (APP.returnToApp) { APP.returnToApp = false; showShell(); if (RS.resume?.base) openResume(); return; }
  go(1);
}

// "About you" opens with what the resume and LinkedIn link already told us, as one short paragraph.
function paintSummary() {
  const about = RS.resume?.base?.about, li = $("#o_lurl").value.trim() || APP.profile?.linkedin_url;
  $("#o_sum").hidden = !about;
  if (about) $("#o_sum").innerHTML = `<div class="ol">What we know so far</div><p>${esc(about)}</p>${li ? `<small>${esc(li.replace(/^https?:\/\/(www\.)?/, ""))}</small>` : ""}`;
}

// chips: single or multi select
document.addEventListener("click", (e) => {
  const b = e.target.closest(".chips2 button");
  if (!b) return;
  const g = b.parentElement;
  if (g.id === "o_sugg") { $("#o_goal").value = b.dataset.v || b.textContent; return; }
  if (g.dataset.multi) b.classList.toggle("on");
  else { g.querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); }
});
const clean = (t) => t.replace(/^[^\w]+/u, "").trim(); // drop emoji prefix
function readChips(k) { return [...document.querySelectorAll(`.chips2[data-k="${k}"] button.on`)].map((b) => clean(b.textContent)); }
function prefillChips() {
  const p = Object.keys(APP.answers).length ? APP.answers : APP.profile || {};
  for (const k of ["fields", "year", "looking_for", "locations"]) {
    const vals = [].concat(p[k] || []);
    document.querySelectorAll(`.chips2[data-k="${k}"] button`).forEach((b) => b.classList.toggle("on", vals.includes(clean(b.textContent))));
  }
}
function aboutContinue() {
  const a = { fields: readChips("fields"), year: readChips("year")[0] || "", looking_for: readChips("looking_for"), locations: readChips("locations") };
  if (!a.year) return ($("#o_aerr").textContent = "Pick your year so we match the right programs.");
  if (!a.fields.length && !a.looking_for.length) return ($("#o_aerr").textContent = "Pick at least one interest or what you’re looking for.");
  $("#o_aerr").textContent = "";
  APP.answers = a;
  go(1);
}
const SUGG = {
  "Software / Tech": "Land a software engineering internship this summer", "AI / ML": "Land an AI/ML internship this summer",
  "Finance": "Get a summer analyst role in finance", "Consulting": "Land a consulting internship this summer",
  "STEM research": "Do paid STEM research in a lab this summer", "Humanities / social science research": "Get a funded humanities research fellowship",
  "Policy / Government": "Intern in policy or government in DC", "Startups / VC": "Work at an early-stage startup or VC fund",
  "Health / Bio": "Get a summer research position in health or biotech", "Climate / Energy": "Work on climate or clean energy this summer",
  "Media / Arts / Design": "Land a summer role in media, arts or design", "Nonprofit / Social impact": "Intern at a social-impact nonprofit",
};
function paintSuggestions() {
  const fields = (APP.answers.fields?.length ? APP.answers.fields : APP.profile?.fields) || [];
  const opts = fields.map((f) => SUGG[f]).filter(Boolean).slice(0, 4);
  if ((APP.answers.looking_for || []).includes("Study abroad")) opts.push("Study abroad this summer with Yale funding");
  if (!opts.length) opts.push("Land an internship this summer", "Find a funded summer research position");
  $("#o_sugg").innerHTML = opts.map((o) => `<button data-v="${esc(o)}">${esc(o)}</button>`).join("");
}
async function finishOnboarding() {
  const goal = $("#o_goal").value.trim();
  if (!goal) return $("#o_goal").focus();
  const a = Object.keys(APP.answers).length ? APP.answers : APP.profile || {};
  try {
    const { profile } = await call("/api/profile", { method: "PUT", body: { ...a, linkedin_url: $("#o_lurl").value.trim() || APP.profile?.linkedin_url || "", people: $("#o_people").value.trim() || APP.profile?.people || "", summer_goal: goal, onboarded: true } });
    APP.profile = profile;
  } catch (e) { return toast(e.message); }
  setAbout();
  showShell();
  newChat();
  sendAsk(goal);
}
function editProfile() { APP.answers = {}; showOnboarding("about"); }

<<<<<<< Updated upstream
// Everything the model should know about the student (sent as "about me" with each request).
=======
// Everything Bulldog should know about the student (sent as "about me" with each request).
>>>>>>> Stashed changes
function setAbout() {
  const p = APP.profile || {};
  const bits = [p.year && `${p.year} at Yale`, p.fields?.length && `Interests: ${p.fields.join(", ")}`, p.looking_for?.length && `Looking for: ${p.looking_for.join(", ")}`,
    p.locations?.length && `Locations: ${p.locations.join(", ")}`, p.summer_goal && `Summer goal: ${p.summer_goal}`, RS.resume?.base && aboutFromResume(RS.resume.base)];
  $("#about").value = bits.filter(Boolean).join(" · ");
  if (p.people && !$("#profiles").value) $("#profiles").value = p.people;
}
// resume.js sets #about only when empty; keep ours in sync whenever the resume loads.
const _paintOnb = paintOnboarding;
paintOnboarding = function () { $("#onboard").hidden = true; $("#resumebtn").textContent = RS.resume?.base ? "📄 My resume" : "📄 Add resume"; setAbout(); };

// ---------------- chat ----------------
function showShell() { $("#onb").hidden = true; $("#shell").hidden = false; }
const firstName = () => (RS.resume?.base?.name || AUTH.session?.user?.email || "").split(/[ .@]/)[0].replace(/^./, (c) => c.toUpperCase());

function parkSingletons() {
  $("#deck").hidden = true; $("#park").appendChild($("#deck"));
  $("#out").innerHTML = ""; $("#park").appendChild($("#out"));
}
function newChat() {
  parkSingletons();
  Object.assign(S, { goal: "", deck: [], liked: [], seen: [], plan: null, outreach: {} });
  document.querySelectorAll(".side-hist .hrow").forEach((r) => r.classList.remove("on"));
  const p = APP.profile || {};
  const starters = [
    p.summer_goal && [p.summer_goal, "Your goal"],
    ...(p.fields || []).slice(0, 2).map((f) => SUGG[f] && [SUGG[f], f]),
    ["Find info sessions and coffee chats this month", "Events"],
    ["What fellowships can fund my summer?", "Funding"],
  ].filter(Boolean).filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i).slice(0, 4);
  $("#thread").innerHTML = `<div class="empty-hero">
    <h1>${firstName() ? `Hi ${esc(firstName())}.` : "Hi."} What do you want to achieve this summer?</h1>
    <p>Openings matched to ${p.year ? `a Yale ${esc(p.year.toLowerCase())}` : "you"}${p.fields?.length ? ` in ${esc(p.fields.slice(0, 2).join(" and "))}` : ""}, with deadlines synced to your calendar.</p>
    <div class="starter">${starters.map(([t, s]) => `<button data-v="${esc(t)}" onclick="sendAsk(this.dataset.v)">${esc(t)}<small>${esc(s)}</small></button>`).join("")}</div>
  </div>`;
  $("#ask").value = ""; $("#ask").focus();
}
function addUser(text) {
  $("#thread .empty-hero")?.remove();
  const d = document.createElement("div"); d.className = "msg-u"; d.textContent = text;
  $("#thread").appendChild(d);
}
function addAssistant(html) {
  const d = document.createElement("div"); d.className = "msg-a";
  d.innerHTML = `<div class="av">B_</div><div class="body">${html}</div>`;
  $("#thread").appendChild(d);
  return d.querySelector(".body");
}
function ask(e) { e.preventDefault(); const t = $("#ask").value.trim(); if (t) sendAsk(t); }
async function sendAsk(text) {
  $("#ask").value = ""; autoGrow();
  // A previous deck in this thread collapses to a one-line summary.
  const prev = $("#deck").parentElement;
  if (prev && prev.id !== "park") prev.insertAdjacentHTML("beforeend", `<p class="why">Showed ${S.seen.length} opportunities · ${S.liked.length} saved to your list.</p>`);
  addUser(text);
  const body = addAssistant(`<p>Searching for openings that fit <b>${esc(text)}</b><span class="typing"><i></i><i></i><i></i></span></p>`);
  body.appendChild($("#deck"));
  $("#goal").value = text;
  if (!readGoal()) return;
  await loadDeck();
  body.querySelector("p").innerHTML = S.deck.length
    ? `<b>${S.deck.length} openings</b> for “${esc(text)}”. Swipe right to save — saved ones get their deadlines on your calendar.`
    : `No new openings for “${esc(text)}”. Try a broader goal.`;
}

// Plan → its own assistant message.
const _buildPlan = buildPlan;
buildPlan = async function () {
  const body = addAssistant(`<p>Here’s your game plan${S.liked.length ? ` for your ${S.liked.length} pick${S.liked.length > 1 ? "s" : ""}` : ""}.</p>`);
  body.appendChild($("#out"));
  await _buildPlan();
  if (S.plan) addAssistant(`<p>Next steps:</p><div class="chips-inline"><button onclick="openList()">📌 Open my list</button><button onclick="openResume()">📄 Review my resume</button><button onclick="openCalendar()">📅 Sync dates to my calendar</button></div>`);
  loadHistory();
};
// Past chats (saved plans) open in the thread.
const _openPlan = openPlan;
openPlan = async function (id) {
  parkSingletons();
  $("#thread").innerHTML = "";
  const body = addAssistant(`<p class="loading"><i></i>Opening…</p>`);
  body.appendChild($("#out"));
  await _openPlan(id);
  body.querySelector("p.loading")?.remove();
  if (S.goal) $("#thread").prepend(Object.assign(document.createElement("div"), { className: "msg-u", textContent: S.goal }));
  document.querySelectorAll(".side-hist .hrow").forEach((r) => r.classList.toggle("on", r.getAttribute("onclick")?.includes(id)));
  window.scrollTo(0, 0);
  $("#side").classList.remove("open");
};
openHistory = function () { $("#side").classList.add("open"); };

// List modal
function openList() { $("#listmodal").hidden = false; loadCart(); $("#side").classList.remove("open"); }
const _renderCart2 = renderCart;
renderCart = function () { _renderCart2(); $("#listempty").hidden = CART.items.length > 0; };

// Resume: if none yet, jump to the upload step and come back.
const _openResume = openResume;
openResume = function () {
  if (!RS.resume?.base) { APP.returnToApp = true; return showOnboarding("resume"); }
  _openResume();
};

// Composer: Enter sends, Shift+Enter new line, auto-grow.
function autoGrow() { const t = $("#ask"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 180) + "px"; }
$("#ask").addEventListener("input", autoGrow);
$("#ask").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#composer").requestSubmit(); } });

// Confetti when an application turns into an offer.
const _setItem = setItem;
setItem = async function (id, patch) {
  await _setItem(id, patch);
  if (patch.status === "offer") confetti();
};
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = Object.assign(document.createElement("div"), { className: "confetti" });
  const colors = ["#34C759", "#F5C48C", "#0A84FF", "#FF5A47", "#FFFFFF"];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement("i");
    p.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % 5]};animation-delay:${Math.random() * 0.4}s;transform:rotate(${Math.random() * 180}deg)`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2200);
}
