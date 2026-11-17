// Bulldog Reach — goal-first outreach for Yale students, powered by Grok.
// Zero dependencies: `node server.js` then open http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");

// --- tiny .env loader ---
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.XAI_API_KEY || "";
const MODEL = process.env.GROK_MODEL || "grok-4.20-0309-non-reasoning";
const DEMO = !API_KEY || process.env.DEMO_MODE === "1";
const today = () => new Date().toISOString().slice(0, 10);

const PLAN_SYSTEM = `You are Bulldog Reach, an outreach strategist for Yale students.
A student gives you a GOAL, a short ABOUT ME, optionally pasted PROFILES (LinkedIn text), and optionally OPPORTUNITIES THEY LIKED (swiped right).
Your job: turn the goal into a concrete game plan and outreach that actually advances the goal — not generic networking.

Rules:
- Work backwards from the goal: what outcome is needed, who can unlock it, what ask fits each person.
- If the student liked specific opportunities, aim the plan and the people at THOSE (people who can refer/advise for them).
- Prioritize Yale ties (same residential college, clubs, major, teams, professors, Yale alumni) — warm beats cold.
- If profiles are pasted, rank THOSE people. If none, propose 4-5 specific people or roles to find (use real, public, findable people when you're confident; otherwise describe the role precisely and how to find them at Yale).
- Pull a recent, specific post/news item per person as the "hook". Never invent quotes; if no hook is known, say what to look for.
- Messages: under 90 words, one specific ask, reference the hook and the Yale tie, no flattery filler, no "I hope this finds you well".
- reply_likelihood is 0-100, honest. Explain it in one line.

Return ONLY JSON with this exact shape:
{
  "goal_summary": string,
  "north_star": string,               // the concrete outcome, ONE punchy sentence, max 14 words, ends with a deadline
  "game_plan": [ { "step": number, "title": string, "who": string, "ask": string, "why": string } ],  // exactly 4 steps; title max 4 words; who/ask max 12 words each
  "people": [ {
     "name": string, "headline": string, "step": number,
     "yale_ties": [string], "fit_score": number, "reply_likelihood": number, "likelihood_reason": string,
     "hook": string, "hook_source": string, "ask": string, "subject": string, "message": string,
     "follow_up": string,           // what to send if no reply
     "follow_up_days": number       // days after sending to follow up (3-7)
  } ],
  "this_week": [string]              // 3 concrete actions with numbers ("send 4 messages by Thursday")
}`;

const OPPS_SYSTEM = `You find real opportunities for a Yale student's goal: internships, jobs, research labs/RA roles, fellowships, programs.
Rules:
- Real, currently open or recurring opportunities only. Use search. Prefer ones with a Yale connection (Yale alumni there, Yale programs, Yale labs, Yale funding).
- Include the application deadline as YYYY-MM-DD when known (must be after today); if rolling or unknown, use null and say so in deadline_note.
- Mix types and difficulty. 8 items.
Return ONLY JSON:
{ "opportunities": [ {
   "title": string, "org": string, "type": "internship"|"job"|"research"|"fellowship"|"program",
   "location": string, "deadline": string|null, "deadline_note": string,
   "url": string, "pitch": string,          // 1 punchy line on why it's great, max 16 words
   "yale_tie": string, "fit": number          // 0-100 fit for this student
} ] }`;

const DETAIL_SYSTEM = `You help a Yale student apply to ONE specific opportunity. Research it (official page, Yale OCS, employer events, X posts) and return what they need to act.
Rules:
- events: real upcoming dates only (after today): application deadline(s), info sessions, office hours, employer/Yale OCS events, networking events, recruiter coffee chats. date YYYY-MM-DD or null if unknown; set verified=true only if you saw the date on an official/primary source and include its url.
- checklist: 5-9 concrete, ordered steps to submit a strong application (materials, essays, recommenders, outreach, prep). Short imperative text.
- next_actions: the 3 most important things to do THIS WEEK.
- messages: 1-3 short drafts (under 90 words) to real or role-described people who can help (Yale alumni at the org, the program contact, a professor). One specific ask each. Never invent quotes.
- keywords: 8-15 skills/terms the application and resume should reflect.
Return ONLY JSON:
{ "summary": string, "eligibility": string,
  "events": [ { "title": string, "kind": "deadline"|"info_session"|"office_hours"|"event"|"coffee_chat", "date": string|null, "time": string, "url": string, "verified": boolean } ],
  "checklist": [ { "id": string, "text": string, "kind": "application"|"outreach"|"prep" } ],
  "next_actions": [string],
  "messages": [ { "to": string, "why": string, "subject": string, "body": string } ],
  "keywords": [string] }`;

const RESUME_PARSE_SYSTEM = `Convert a student's resume text (and optional LinkedIn profile export text) into structured JSON. Copy facts exactly; do NOT invent, embellish, or add numbers. Merge LinkedIn-only items into "other" or the right section and mark them with "source":"linkedin".
Give every item and bullet a short unique id (e.g. "e1", "e1b2").
Return ONLY JSON:
{ "name": string, "contact": { "email": string, "phone": string, "location": string, "links": [string] },
  "summary": string,
  "section_order": ["education","experience","projects","leadership","skills"],
  "education": [ { "id": string, "school": string, "degree": string, "dates": string, "location": string, "bullets": [ { "id": string, "text": string } ] } ],
  "experience": [ { "id": string, "org": string, "role": string, "dates": string, "location": string, "source": "resume"|"linkedin", "bullets": [ { "id": string, "text": string } ] } ],
  "projects": [ { "id": string, "name": string, "dates": string, "bullets": [ { "id": string, "text": string } ] } ],
  "leadership": [ { "id": string, "org": string, "role": string, "dates": string, "bullets": [ { "id": string, "text": string } ] } ],
  "skills": [ { "id": string, "label": string, "items": [string] } ] }`;

const TAILOR_SYSTEM = `You are a careful resume editor. Given a student's structured resume and ONE target opportunity, propose specific, reviewable edits that make the resume fit THIS opportunity. The student approves each edit; nothing is applied automatically.
Hard rules (honesty):
- Never invent experience, skills, employers, titles, dates, results, or numbers. Only rephrase, reorder, emphasize, or trim what is already there.
- Every claim in "after" must be supported by the original bullet or elsewhere in the resume. Do NOT add scope or impact words the resume doesn't state (e.g. "large-scale", "production", "optimized", "led", "high-impact", "comprehensive") — if the student might have done it, ask via a placeholder like "[scale?]" and set needs_input=true.
- Prefer stronger verbs and the opportunity's vocabulary ONLY where the meaning stays identical.
- If a bullet would be stronger with a metric the resume doesn't contain, write the rewrite with a placeholder like "[X%]" or "[N users]" and set needs_input=true. Never guess a number.
- If numbers would hurt for this opportunity (e.g. some research or arts programs), you may suggest removing them.
- Keywords: only suggest adding a skill/term if the resume or LinkedIn already supports it.
Suggestion kinds:
- "rewrite_bullet": target {section, item_id, bullet_id}, before, after
- "reorder_bullets": target {section, item_id}, order: [bullet_ids in new order]
- "reorder_items": target {section}, order: [item_ids in new order]
- "reorder_sections": order: [section names]
- "hide_item": target {section, item_id} — de-emphasize something irrelevant (student can keep it)
- "add_skill": target {skill_id or null, label}, after: the skill term
- "edit_summary": before, after
Return 6-14 high-impact suggestions, most important first. Return ONLY JSON:
{ "fit_notes": string, "keywords": [string],
  "suggestions": [ { "id": string, "kind": string, "target": object, "before": string, "after": string, "order": [string], "reason": string, "needs_input": boolean } ] }`;

async function post(url, body, ms) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`xAI ${r.status}: ${text.slice(0, 300)}`), { status: r.status });
  return JSON.parse(text);
}
const parseJSON = (s) => {
  const m = String(s || "").match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : s);
};

// Ask Grok for JSON, with live X + web search (Agent Tools API); fall back to plain chat if search fails.
async function grokJSON(system, user, searchHint) {
  const sys = `${system}\n\nToday is ${today()}.`;
  try {
    const data = await post("https://api.x.ai/v1/responses", {
      model: MODEL,
      input: [
        { role: "system", content: `${sys}\n\n${searchHint} Keep it to a few searches. Output the JSON object only.` },
        { role: "user", content: user },
      ],
      tools: [{ type: "x_search" }, { type: "web_search" }],
    }, 75000);
    const msg = (data.output || []).filter((o) => o.type === "message").pop();
    const text = (msg?.content || []).map((c) => c.text || "").join("");
    const searches = (data.output || []).filter((o) => /search/.test(o.type) || /search/.test(o.name || "")).length;
    const json = parseJSON(text);
    json._meta = { model: data.model || MODEL, live_search: searches > 0, searches, demo: false };
    return json;
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e;
    console.error("live search failed, falling back:", e.message);
    const data = await post("https://api.x.ai/v1/chat/completions", {
      model: MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }, 60000);
    const json = parseJSON(data.choices?.[0]?.message?.content);
    json._meta = { model: data.model || MODEL, live_search: false, demo: false };
    return json;
  }
}

// Plain JSON call, no search (resume parsing / tailoring work only on what the student gave us).
async function grokPlain(system, user, ms = 90000) {
  const data = await post("https://api.x.ai/v1/chat/completions", {
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: `${system}\n\nToday is ${today()}.` }, { role: "user", content: user }],
  }, ms);
  return parseJSON(data.choices?.[0]?.message?.content);
}

function planPrompt({ goal, about, profiles, liked }) {
  const likedTxt = (liked || []).map((o) => `- ${o.title} @ ${o.org} (${o.type}${o.deadline ? ", deadline " + o.deadline : ""}) ${o.url || ""}`).join("\n");
  return `GOAL: ${goal}\n\nABOUT ME: ${about || "(not given)"}\n\nOPPORTUNITIES I LIKED:\n${likedTxt || "(none)"}\n\nPROFILES:\n${profiles?.trim() || "(none pasted — propose people/roles to find)"}`;
}

// ---------- demo data (no API key) ----------
function demoOpps() {
  const y = new Date().getFullYear() + 1;
  return {
    _meta: { model: "demo", demo: true },
    opportunities: [
      { title: "Grok Summer Intern — Post-training", org: "SpaceXSI (example)", type: "internship", location: "Palo Alto", deadline: `${y}-01-15`, deadline_note: "Rolling; early apps favored", url: "https://x.ai/careers", pitch: "Ship RL evals on a frontier model your first week.", yale_tie: "3 Yale NLP Lab alumni on team", fit: 90 },
      { title: "Undergrad RA — NLP & Agents Lab", org: "Yale CS (example)", type: "research", location: "New Haven", deadline: `${y}-02-01`, deadline_note: "Email PI with a 1-page proposal", url: "https://cpsc.yale.edu", pitch: "Co-author a benchmark paper before junior year.", yale_tie: "On campus", fit: 84 },
      { title: "Tsai CITY Summer Fellowship", org: "Yale Tsai CITY (example)", type: "fellowship", location: "New Haven", deadline: `${y}-03-01`, deadline_note: "Funding for student ventures", url: "https://city.yale.edu", pitch: "Get paid to keep building tonight's hack all summer.", yale_tie: "Yale program", fit: 78 },
      { title: "Applied AI Engineer Intern", org: "AI startup (example)", type: "internship", location: "NYC", deadline: null, deadline_note: "Rolling", url: "https://www.ycombinator.com/jobs", pitch: "Small team, real ownership, Yale '22 founder.", yale_tie: "Founder is Yale '22", fit: 72 },
    ],
  };
}

function demoPlan(goal) {
  return {
    _meta: { model: "demo", live_search: false, demo: true },
    goal_summary: goal || "Land a summer research role building AI agents",
    north_star: "A signed summer offer on an applied-AI team by March 1",
    game_plan: [
      { step: 1, title: "Map the field", who: "Yale alumni 1-3 yrs into AI eng roles", ask: "15-min chat: which teams hire undergrads and how", why: "Recent grads remember the path and reply most" },
      { step: 2, title: "Get a referral", who: "Engineers on target teams with a Yale tie", ask: "Feedback on your project → referral if it lands", why: "Referrals convert ~5x vs cold applications" },
      { step: 3, title: "Prove it", who: "Yale faculty / lab leads in AI", ask: "Can I contribute to X for 4 weeks?", why: "A concrete contribution beats a resume line" },
      { step: 4, title: "Close", who: "Hiring manager", ask: "Interview for summer slot", why: "Arrive pre-vouched" },
    ],
    people: [
      { name: "Maya Chen (example)", headline: "SWE @ AI lab · Yale '24 · Silliman", step: 1, yale_ties: ["Silliman College", "y/cs alum", "CS major"], fit_score: 92, reply_likelihood: 71, likelihood_reason: "Same college + club, posts actively, recent grad", hook: "Posted last week about shipping a tool-use eval harness", hook_source: "X post (demo)", ask: "15-min call on how she broke into agents work", subject: "Silliman → agents eval?", message: "Hi Maya — fellow Silliman + y/cs member here. Your post on the tool-use eval harness was exactly what I'm trying to learn: I just built an outreach agent on Grok at tonight's Grokathon. Could I grab 15 minutes next week to ask how you landed on an agents team as a recent grad? Happy to work around your schedule.", follow_up: "Share a 30-sec demo link of your project and ask one specific question about her eval harness.", follow_up_days: 5 },
      { name: "Prof. (AI lab lead, example)", headline: "Yale CS faculty · NLP & agents", step: 3, yale_ties: ["Yale faculty", "Taught CPSC course you took"], fit_score: 84, reply_likelihood: 48, likelihood_reason: "Faculty are busy; a concrete contribution raises odds", hook: "Lab released a new benchmark this month", hook_source: "Lab website (demo)", ask: "Contribute to the benchmark for 4 weeks", subject: "Contributing to your new benchmark", message: "Hi Professor — I'm a Yale undergrad who took CPSC 1001 and has been building with LLM agents. I read your lab's new benchmark and have an idea for 20 extra adversarial tasks. Could I build them over 4 weeks as a trial contribution? I can send a 1-page plan by Friday.", follow_up: "Send the 1-page plan anyway — attach it, don't ask permission twice.", follow_up_days: 4 },
      { name: "Jordan Patel (example)", headline: "Product @ SpaceXSI · Yale '21", step: 2, yale_ties: ["Yale alum", "Former YHack organizer"], fit_score: 88, reply_likelihood: 39, likelihood_reason: "Senior + busy, but strong alumni tie and hackathon overlap", hook: "Judged a Yale hackathon tonight", hook_source: "Event (demo)", ask: "Feedback on your Grokathon build", subject: "Grokathon build — 2 min of feedback?", message: "Hi Jordan — I built Bulldog Reach at tonight's y/cs Grokathon: it turns a student's goal into a ranked outreach plan using Grok live search. As a former YHack organizer, what's the one thing you'd change before I ship it to Yale students? Two minutes of feedback would mean a lot.", follow_up: "Reply with usage numbers after launch week.", follow_up_days: 7 },
    ],
    this_week: ["Send 4 step-1 messages by Thursday", "Ship a 30-sec demo video of your project", "Book 2 calls before next Tuesday"],
  };
}

// ---------------- beta: auth, limits, persistence (Supabase) ----------------
// Enabled when SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_KEY are set.
// Without them the app runs open (local/dev) with an in-memory per-IP limit.
const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SB_ANON = process.env.SUPABASE_ANON_KEY || "";
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || "";
const AUTH = !!(SB_URL && SB_ANON && SB_SERVICE);
const DOMAIN = (process.env.ALLOWED_DOMAIN || "yale.edu").toLowerCase();
const LIMITS = {
  plan: +process.env.DAILY_PLAN_LIMIT || 10,
  deck: +process.env.DAILY_DECK_LIMIT || 15,
  detail: +process.env.DAILY_DETAIL_LIMIT || 40, // opportunity research when added to cart
  tailor: +process.env.DAILY_TAILOR_LIMIT || 20,
  parse: +process.env.DAILY_PARSE_LIMIT || 6,
};
const MONTHLY_CAP = +process.env.MONTHLY_CALL_CAP || 3000; // total Grok calls across all users per month
const STATUSES = ["todo", "sent", "replied", "meeting", "referred", "no_reply"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const userCache = new Map();
async function getUser(req) {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!tok) return null;
  const hit = userCache.get(tok);
  if (hit && hit.exp > Date.now()) return hit.user;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const user = { id: u.id, email: String(u.email || "").toLowerCase() };
  userCache.set(tok, { user, exp: Date.now() + 5 * 60e3 });
  return user;
}
const domainOk = (email) => email.endsWith("@" + DOMAIN) || email.endsWith("." + DOMAIN);

async function sb(pathq, { method = "GET", body, prefer } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${pathq}`, {
    method,
    // New-style keys (sb_secret_…) go in `apikey` only; legacy service_role JWTs also need the Bearer header.
    headers: { apikey: SB_SERVICE, ...(SB_SERVICE.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_SERVICE}` }), "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new HttpError(500, `Database error (${r.status}): ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// Local fallback limiter (no Supabase): per IP, per day, in memory.
const memUsage = new Map();
async function bump(user, kind) {
  if (!AUTH) {
    const k = `${user.id}|${today()}|${kind}`;
    const n = (memUsage.get(k) || 0) + 1;
    if (n > LIMITS[kind]) throw new HttpError(429, `Daily limit reached (${LIMITS[kind]} ${kind}s). Try again tomorrow.`);
    memUsage.set(k, n);
    return { used: n, limit: LIMITS[kind] };
  }
  const out = await sb("rpc/bump_usage", { method: "POST", body: { p_user: user.id, p_kind: kind, p_limit: LIMITS[kind], p_monthly_cap: MONTHLY_CAP } });
  if (out === -1) throw new HttpError(429, `You've used all ${LIMITS[kind]} ${kind === "plan" ? "game plans" : "opportunity decks"} for today. Resets at midnight UTC.`);
  if (out === -2) throw new HttpError(429, "Bulldog Reach hit its monthly capacity. We'll be back soon.");
  return { used: out, limit: LIMITS[kind] };
}

async function guard(req) {
  if (!AUTH) return { id: "ip:" + (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim(), email: null };
  const user = await getUser(req);
  if (!user) throw new HttpError(401, "Please sign in with your Yale email.");
  if (!domainOk(user.email)) throw new HttpError(403, `Bulldog Reach is only open to @${DOMAIN} accounts for now.`);
  return user;
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 600e3) { reject(new HttpError(413, "Request too large")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}
const clip = (s, n) => String(s || "").slice(0, n);

// ---------------- cart / resume helpers ----------------
const { ics } = require("./lib/ics");
const store = require("./lib/store")({ AUTH, sb, root: __dirname });
const CART_STATUSES = ["saved", "applying", "submitted", "interview", "offer", "dropped"];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

function sanitizeOpp(o = {}) {
  const deadline = isDate(o.deadline) && o.deadline >= today() ? o.deadline : null;
  return {
    title: clip(o.title, 200), org: clip(o.org, 160), type: clip(o.type, 30), location: clip(o.location, 120),
    deadline, deadline_note: clip(o.deadline_note, 200), url: /^https?:\/\//.test(o.url || "") ? clip(o.url, 500) : "",
    pitch: clip(o.pitch, 300), yale_tie: clip(o.yale_tie, 200), fit: Math.max(0, Math.min(100, +o.fit || 0)),
  };
}

function publicBase(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0];
  return `${proto}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

// Research one cart item (events, checklist, messages) in the background; never throws.
async function enrich(user, item) {
  try {
    await bump(user, "detail");
    const detail = DEMO ? demoDetail(item.opp) : await grokJSON(DETAIL_SYSTEM, `OPPORTUNITY:\n${JSON.stringify(item.opp)}`, "Use web_search (official page, ocs.yale.edu, events.yale.edu) and x_search to find real deadlines, info sessions, and contacts.");
    const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? clip(u, 500) : "");
    const KINDS = ["deadline", "info_session", "office_hours", "event", "coffee_chat"];
    detail.events = (detail.events || []).filter((e) => e && e.title).slice(0, 12).map((e) => ({
      title: clip(e.title, 200), kind: KINDS.includes(e.kind) ? e.kind : "event", time: clip(e.time, 60), url: safeUrl(e.url),
      verified: !!e.verified && !!safeUrl(e.url), date: isDate(e.date) && e.date >= today() ? e.date : null,
    }));
    detail.checklist = (detail.checklist || []).slice(0, 12).map((c, i) => ({ id: String(c.id || "").replace(/[^\w-]/g, "").slice(0, 40) || "c" + i, text: clip(c.text, 200), kind: ["application", "outreach", "prep"].includes(c.kind) ? c.kind : "application" }));
    detail.messages = (detail.messages || []).slice(0, 4).map((m) => ({ to: clip(m.to, 160), why: clip(m.why, 200), subject: clip(m.subject, 200), body: clip(m.body, 1200) }));
    detail.next_actions = (detail.next_actions || []).slice(0, 5).map((a) => clip(a, 200));
    detail.keywords = (detail.keywords || []).slice(0, 20).map((k) => clip(k, 60));
    await store.cartUpdate(user.id, item.id, { detail });
  } catch (e) {
    console.error("enrich failed:", e.message);
    await store.cartUpdate(user.id, item.id, { detail: { error: e.status === 429 ? e.message : "Couldn't research this one. Try refresh." } }).catch(() => {});
  }
}

// Make sure every resume item/bullet has an id and the expected arrays exist.
function normalizeResume(r = {}) {
  let n = 0;
  const id = (x, p) => (x && typeof x === "string" ? clip(x, 40) : `${p}${(n++).toString(36)}`);
  const bullets = (bs, p) => (Array.isArray(bs) ? bs : []).slice(0, 12).map((b) => (typeof b === "string" ? { id: id(null, p + "b"), text: clip(b, 400) } : { id: id(b.id, p + "b"), text: clip(b.text, 400) }));
  const items = (arr, p, fields) => (Array.isArray(arr) ? arr : []).slice(0, 15).map((it) => {
    const o = { id: id(it.id, p), hidden: !!it.hidden, bullets: bullets(it.bullets, p) };
    for (const f of fields) o[f] = clip(it[f], 200);
    if (it.source) o.source = clip(it.source, 20);
    return o;
  });
  return {
    name: clip(r.name, 120), summary: clip(r.summary, 800),
    contact: { email: clip(r.contact?.email, 120), phone: clip(r.contact?.phone, 40), location: clip(r.contact?.location, 120), links: (r.contact?.links || []).slice(0, 5).map((l) => clip(l, 200)) },
    section_order: (Array.isArray(r.section_order) && r.section_order.length ? r.section_order : ["education", "experience", "projects", "leadership", "skills"]).filter((s) => ["education", "experience", "projects", "leadership", "skills"].includes(s)),
    education: items(r.education, "ed", ["school", "degree", "dates", "location"]),
    experience: items(r.experience, "ex", ["org", "role", "dates", "location"]),
    projects: items(r.projects, "pr", ["name", "dates"]),
    leadership: items(r.leadership, "le", ["org", "role", "dates"]),
    skills: (Array.isArray(r.skills) ? r.skills : []).slice(0, 8).map((s) => ({ id: id(s.id, "sk"), label: clip(s.label, 60), items: (s.items || []).slice(0, 30).map((x) => clip(x, 60)) })),
  };
}

function demoDetail(o) {
  const y = new Date().getFullYear() + 1;
  return {
    summary: `${o.title} at ${o.org} (demo data).`, eligibility: "Yale undergraduates (demo).",
    events: [{ title: `${o.org} info session (demo)`, kind: "info_session", date: `${y}-01-08`, time: "5:00 PM", url: o.url, verified: false }],
    checklist: [{ id: "c1", text: "Read the full posting and eligibility", kind: "prep" }, { id: "c2", text: "Tailor your resume to the keywords", kind: "application" }, { id: "c3", text: "Message a Yale alum at the org", kind: "outreach" }, { id: "c4", text: "Submit the application", kind: "application" }],
    next_actions: ["Tailor resume", "Message one alum", "Put the deadline on your calendar"],
    messages: [{ to: "Yale alum at " + o.org, why: "Warm intro", subject: "Yale student interested in " + o.title, body: "Hi — I'm a Yale student applying to " + o.title + ". Could I ask you two quick questions about the team? 15 minutes any time next week works." }],
    keywords: ["Python", "research", "communication"],
  };
}
function demoResume() {
  return { name: "Demo Student", contact: { email: "demo@yale.edu" }, summary: "", section_order: ["education", "experience", "skills"],
    education: [{ id: "ed1", school: "Yale University", degree: "B.S. Computer Science", dates: "2023–2027", bullets: [] }],
    experience: [{ id: "ex1", org: "Campus Lab", role: "Research Assistant", dates: "2025", bullets: [{ id: "ex1b1", text: "Built data pipelines for a research project" }, { id: "ex1b2", text: "Presented results at lab meeting" }] }],
    skills: [{ id: "sk1", label: "Technical", items: ["Python", "SQL"] }] };
}
function demoTailor(r) {
  const b = r.experience?.[0]?.bullets?.[0];
  return { fit_notes: "Demo suggestions.", keywords: ["Python"], suggestions: b ? [{ kind: "rewrite_bullet", target: { section: "experience", item_id: r.experience[0].id, bullet_id: b.id }, before: b.text, after: b.text + " processing [N] records/day", reason: "Quantify scale (fill in the real number).", needs_input: true }] : [] };
}

http
  .createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    try {
      if (url === "/api/config" || url === "/api/status") {
        return send(res, 200, { demo: DEMO, model: MODEL, emailCode: process.env.AUTH_EMAIL_CODE === "1", auth: AUTH, domain: DOMAIN, limits: LIMITS, supabaseUrl: AUTH ? SB_URL : null, supabaseAnonKey: AUTH ? SB_ANON : null });
      }
      if (req.method === "POST" && url === "/api/plan") {
        const user = await guard(req);
        const b = await readBody(req);
        if (!b.goal) return send(res, 400, { error: "Tell us your goal first." });
        const input = { goal: clip(b.goal, 300), about: clip(b.about, 1500), profiles: clip(b.profiles, 12000), liked: (Array.isArray(b.liked) ? b.liked : []).slice(0, 12) };
        const usage = await bump(user, "plan");
        const plan = DEMO ? demoPlan(input.goal) : await grokJSON(PLAN_SYSTEM, planPrompt(input), "Use x_search and web_search to find real, recent posts for hooks. Hook sources should include the post URL when you have one.");
        if (AUTH) {
          const [row] = await sb("plans", { method: "POST", prefer: "return=representation", body: { user_id: user.id, goal: input.goal, liked: input.liked, data: plan } });
          plan._id = row.id;
        }
        plan._usage = usage;
        return send(res, 200, plan);
      }
      if (req.method === "POST" && url === "/api/opportunities") {
        const user = await guard(req);
        const b = await readBody(req);
        if (!b.goal) return send(res, 400, { error: "Tell us your goal first." });
        const usage = await bump(user, "deck");
        if (DEMO) return send(res, 200, { ...demoOpps(), _usage: usage });
        const prompt = `GOAL: ${clip(b.goal, 300)}\n\nABOUT ME: ${clip(b.about, 1500) || "(not given)"}\n\nALREADY SEEN (don't repeat): ${(Array.isArray(b.seen) ? b.seen : []).slice(0, 40).map((s) => clip(s, 120)).join("; ") || "(none)"}`;
        const d = await grokJSON(OPPS_SYSTEM, prompt, "Use web_search (and x_search for fresh hiring posts) to find real openings with real URLs and deadlines.");
        d._usage = usage;
        return send(res, 200, d);
      }
      // --- saved plans + outreach tracker (beta, needs Supabase) ---
      if (url === "/api/plans" && req.method === "GET") {
        const user = await guard(req);
        if (!AUTH) return send(res, 200, { plans: [] });
        const rows = await sb(`plans?select=id,goal,created_at,north_star:data->>north_star&user_id=eq.${user.id}&order=created_at.desc&limit=30`);
        return send(res, 200, { plans: rows });
      }
      const m = url.match(/^\/api\/plans\/([^/]+)$/);
      if (m && req.method === "GET") {
        const user = await guard(req);
        if (!AUTH || !UUID.test(m[1])) return send(res, 404, { error: "Not found" });
        const [row] = await sb(`plans?select=id,goal,liked,data,created_at&id=eq.${m[1]}&user_id=eq.${user.id}`);
        if (!row) return send(res, 404, { error: "Not found" });
        const outreach = await sb(`outreach?select=person,status,updated_at&plan_id=eq.${row.id}`);
        return send(res, 200, { ...row, outreach });
      }
      if (url === "/api/outreach" && req.method === "POST") {
        const user = await guard(req);
        const b = await readBody(req);
        if (!AUTH) return send(res, 200, { ok: true, local: true });
        if (!UUID.test(b.plan_id || "") || !STATUSES.includes(b.status) || !b.person) return send(res, 400, { error: "Bad request" });
        const [own] = await sb(`plans?select=id&id=eq.${b.plan_id}&user_id=eq.${user.id}`);
        if (!own) return send(res, 404, { error: "Not found" });
        await sb("outreach?on_conflict=plan_id,person", { method: "POST", prefer: "resolution=merge-duplicates", body: { user_id: user.id, plan_id: b.plan_id, person: clip(b.person, 200), status: b.status, updated_at: new Date().toISOString() } });
        return send(res, 200, { ok: true });
      }

      // ---------------- cart ("shopping cart" of opportunities) ----------------
      if (url === "/api/cart" && req.method === "GET") {
        const user = await guard(req);
        return send(res, 200, { items: await store.cartList(user.id) });
      }
      if (url === "/api/cart" && req.method === "POST") {
        const user = await guard(req);
        const b = await readBody(req);
        const opp = sanitizeOpp(b.opp);
        if (!opp.title) return send(res, 400, { error: "Missing opportunity" });
        const { item, created } = await store.cartAdd(user.id, opp);
        if (created) enrich(user, item); // research deadlines/events/checklist in the background
        return send(res, created ? 201 : 200, { item, created });
      }
      const cm = url.match(/^\/api\/cart\/([^/]+)(\/refresh)?$/);
      if (cm) {
        const user = await guard(req);
        const id = cm[1];
        if (cm[2] && req.method === "POST") {
          const item = await store.cartGet(user.id, id);
          if (!item) return send(res, 404, { error: "Not found" });
          await store.cartUpdate(user.id, id, { detail: null });
          enrich(user, item);
          return send(res, 202, { ok: true });
        }
        if (req.method === "GET") {
          const item = await store.cartGet(user.id, id);
          return item ? send(res, 200, { item, tailored: await store.tailoredGet(user.id, id) }) : send(res, 404, { error: "Not found" });
        }
        if (req.method === "PATCH") {
          const b = await readBody(req);
          const patch = {};
          if (CART_STATUSES.includes(b.status)) patch.status = b.status;
          if (Array.isArray(b.done)) patch.done = b.done.slice(0, 50).map((x) => clip(x, 40));
          const item = await store.cartUpdate(user.id, id, patch);
          return item ? send(res, 200, { item }) : send(res, 404, { error: "Not found" });
        }
        if (req.method === "DELETE") {
          await store.cartRemove(user.id, id);
          return send(res, 200, { ok: true });
        }
      }

      // ---------------- calendar subscription feed ----------------
      if (url === "/api/calendar" && req.method === "GET") {
        const user = await guard(req);
        const token = await store.calToken(user.id);
        const base = publicBase(req);
        const feed = `${base}/cal/${token}.ics`;
        const webcal = feed.replace(/^https?:/, "webcal:");
        return send(res, 200, { feed, webcal, google: "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal), publicHost: !/localhost|127\.0\.0\.1/.test(base) });
      }
      const calm = url.match(/^\/cal\/([A-Za-z0-9_-]+)\.ics$/);
      if (calm) {
        const uid = await store.uidForToken(calm[1]);
        if (!uid) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache" });
        return res.end(ics(await store.cartList(uid), "Bulldog Reach"));
      }

      // ---------------- resume: onboarding + tailoring ----------------
      if (url === "/api/resume" && req.method === "GET") {
        const user = await guard(req);
        return send(res, 200, { resume: await store.resumeGet(user.id) });
      }
      if (url === "/api/resume/parse" && req.method === "POST") {
        const user = await guard(req);
        const b = await readBody(req);
        const resumeText = clip(b.resume_text, 30000), linkedinText = clip(b.linkedin_text, 30000);
        if (resumeText.length < 80 && linkedinText.length < 80) return send(res, 400, { error: "We couldn't read enough text from your files. Try a different PDF/DOCX." });
        await bump(user, "parse");
        const base = DEMO ? demoResume() : await grokPlain(RESUME_PARSE_SYSTEM, `RESUME TEXT:\n${resumeText || "(none)"}\n\nLINKEDIN EXPORT TEXT:\n${linkedinText || "(none)"}`);
        const saved = await store.resumeSave(user.id, { base: normalizeResume(base), linkedin_url: clip(b.linkedin_url, 300), source_names: (b.source_names || []).slice(0, 4).map((s) => clip(s, 120)) });
        return send(res, 200, { resume: saved });
      }
      if (url === "/api/resume" && req.method === "PUT") {
        const user = await guard(req);
        const b = await readBody(req);
        if (!b.base || typeof b.base !== "object") return send(res, 400, { error: "Bad resume" });
        return send(res, 200, { resume: await store.resumeSave(user.id, { base: normalizeResume(b.base) }) });
      }
      const tm = url.match(/^\/api\/tailor\/([^/]+)$/);
      if (tm) {
        const user = await guard(req);
        const item = await store.cartGet(user.id, tm[1]);
        if (!item) return send(res, 404, { error: "Not found" });
        if (req.method === "GET") return send(res, 200, { tailored: await store.tailoredGet(user.id, item.id) });
        if (req.method === "POST") {
          // Generate SUGGESTIONS only. The resume itself is unchanged until the student accepts edits.
          const r = await store.resumeGet(user.id);
          if (!r?.base) return send(res, 400, { error: "Upload your resume first." });
          await bump(user, "tailor");
          const existing = await store.tailoredGet(user.id, item.id);
          const current = existing?.resume || r.base;
          const out = DEMO ? demoTailor(current) : await grokPlain(TAILOR_SYSTEM, `TARGET OPPORTUNITY:\n${JSON.stringify(item.opp)}\n\nWHAT THEY LOOK FOR:\n${JSON.stringify({ summary: item.detail?.summary, eligibility: item.detail?.eligibility, keywords: item.detail?.keywords })}\n\nRESUME (JSON):\n${JSON.stringify(current)}`);
          // Flag words a suggestion introduces that appear nowhere in the student's resume, so they can check for embellishment.
          const vocab = new Set(JSON.stringify(current).toLowerCase().match(/[a-z][a-z+#.-]{2,}/g) || []);
          const STOP = new Set("the and for with from into that this your their using used use across based while within via per who what when where which over under onto than then also more most such each both".split(" "));
          const newTerms = (txt) => [...new Set((String(txt || "").replace(/\[[^\]]*\]/g, "").toLowerCase().match(/[a-z][a-z+#.-]{2,}/g) || []).filter((w) => !vocab.has(w) && !STOP.has(w) && !vocab.has(w.replace(/(ed|ing|s)$/, ""))))].slice(0, 8);
          const suggestions = (out.suggestions || []).slice(0, 16).map((s, i) => ({
            id: `s${Date.now().toString(36)}${i}`, kind: clip(s.kind, 30), target: s.target || {}, before: clip(s.before, 500), after: clip(s.after, 500),
            order: Array.isArray(s.order) ? s.order.slice(0, 30).map((x) => clip(x, 40)) : [], reason: clip(s.reason, 300), needs_input: !!s.needs_input || /\[[^\]]+\]/.test(s.after || ""),
            new_terms: ["rewrite_bullet", "edit_summary"].includes(s.kind) ? newTerms(s.after) : [],
          }));
          const saved = await store.tailoredSave(user.id, item.id, { resume: current, suggestions, decisions: {}, fit_notes: clip(out.fit_notes, 600), keywords: (out.keywords || []).slice(0, 20) });
          return send(res, 200, { tailored: saved });
        }
        if (req.method === "PUT") {
          // Student-approved state: their edited resume + which suggestions they accepted/rejected.
          const b = await readBody(req);
          if (!b.resume || typeof b.resume !== "object") return send(res, 400, { error: "Bad resume" });
          const decisions = Object.fromEntries(Object.entries(b.decisions || {}).filter(([, v]) => ["accepted", "rejected"].includes(v)).slice(0, 60));
          return send(res, 200, { tailored: await store.tailoredSave(user.id, item.id, { resume: normalizeResume(b.resume), decisions }) });
        }
      }
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message });
    }
    const file = path.join(__dirname, "public", url === "/" || url === "/auth/confirm" ? "index.html" : url);
    if (!file.startsWith(path.join(__dirname, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`Bulldog Reach on http://localhost:${PORT}  (${DEMO ? "DEMO mode — add XAI_API_KEY to .env" : "model " + MODEL} · ${AUTH ? "Yale login ON" : "open mode, no login"})`));
