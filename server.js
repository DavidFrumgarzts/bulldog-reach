// Bulldog Reach — goal-first outreach for Yale students.
// One dependency (the Anthropic SDK): `npm install`, `node server.js`, then open http://localhost:3000
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
const Anthropic = require("@anthropic-ai/sdk");
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
// Two models: Sonnet for anything that needs live web search, Haiku (much cheaper) for reading and writing.
const MODEL_SEARCH = process.env.CLAUDE_MODEL_SEARCH || "claude-sonnet-5-5"; // opportunity deck, game plan, list research
const MODEL_FAST = process.env.CLAUDE_MODEL_FAST || "claude-haiku-5-5"; // resume reading, tailoring, drafts
const MODEL = MODEL_SEARCH; // shown in logs / config
const EFFORT = process.env.REACH_EFFORT || "low"; // low | medium | high — higher is more thorough and slower
// AI features (chat deck, game plan, resume reading, tailoring, list research) call the paid Anthropic API.
// Without a key they are OFF and say so. Sample data is shown only if you opt in with DEMO_MODE=1, and it is fake.
const AI = !!API_KEY && process.env.DEMO_MODE !== "1";
const DEMO = !AI && process.env.DEMO_MODE === "1";
const AI_OFF = "AI features are off: they need an Anthropic API key, which is paid per use. Add ANTHROPIC_API_KEY to .env to turn them on. The Workspace (/workspace) works without it.";
const claude = AI ? new Anthropic({ apiKey: API_KEY, maxRetries: 1 }) : null;
// If a model declines a request, the API can re-run it on a fallback model in the same call (these models only; not Haiku).
const hasFallbacks = (m) => /^claude-(fable-5-[12]|opus-5|sonnet-5-5)/.test(m);
const today = () => new Date().toISOString().slice(0, 10);

// Tone for everything the student reads. It governs wording only: facts still have to come from what was found.
const VOICE = `Voice: you are Bulldog. Write plainly and decisively. No disclaimers, caveats or hedging ("may", "might", "possibly", "unconfirmed", "verify", "double-check", "check the site", "TBA"). Never mention AI, a model or any vendor. This is about wording only: every name, date, URL and quote must come from what you found. Leave a field empty or null rather than fill it with a guess.`;
const cleanName = (s) => String(s || "").replace(/\s*\([^)]*\)/g, "").replace(/\s+[-–—]\s+find .*$/i, "").trim();

// A person to reach is a named individual with links we can stand behind.
const ROLE_WORDS = /\b(office|team|department|committee|admissions|staff|adviser|advisor|coordinator|recruiter|alumni|alum|alumnus|students?|manager|director|officer|representative|contact|program)\b/i;
const isPerson = (name) => { const n = cleanName(name); return /\S+\s+\S+/.test(n) && !ROLE_WORDS.test(n); };
const personLinks = (p) => ({
  url: /^https?:\/\//.test(p.url || "") ? clip(p.url, 500) : "",
  linkedin_url: /^https?:\/\/([a-z]+\.)?linkedin\.com\/in\/[^\s/?#]+/i.test(p.linkedin_url || "") ? clip(p.linkedin_url, 300) : "",
  photo_url: /^https:\/\/\S+$/.test(p.photo_url || "") ? clip(p.photo_url, 500) : "",
});

const PLAN_SYSTEM = `You are Bulldog Reach, an outreach strategist for Yale students.
A student gives you a GOAL, a short ABOUT ME, optionally pasted PROFILES (LinkedIn text), and optionally OPPORTUNITIES THEY LIKED (swiped right).
Your job: turn the goal into a concrete game plan and outreach that actually advances the goal — not generic networking.

Rules:
- Work backwards from the goal: what outcome is needed, who can unlock it, what ask fits each person.
- If the student liked specific opportunities, aim the plan and the people at THOSE (people who can refer/advise for them).
- Prioritize Yale ties (same residential college, clubs, major, teams, professors, Yale alumni) — warm beats cold.
- If profiles are pasted, rank THOSE people. If none, search and name 4-6 real, specific people tied to the liked opportunities or the goal: program directors and coordinators, faculty leads, recruiters, Yale alumni who did it, current students in it. Use each person's real full name and title from a page you found. Every person must be a specific, named individual: never a role, an office or a team. Return fewer people rather than a placeholder.
- name: the person's full name only. No parentheses, instructions or URLs.
- url: the page where you found them. linkedin_url: their own LinkedIn profile (linkedin.com/in/...) when that exact URL appeared in your results, else "". photo_url: the direct URL of their headshot image when one appeared in your results, else "".
- hook: one recent, specific, real thing about the person (a post, talk, paper, announcement, or news from their program). Never invent quotes. If you found none, set hook and hook_source to empty strings.
- Messages: under 90 words, one specific ask, reference the hook and the Yale tie, no flattery filler, no "I hope this finds you well".
- reply_likelihood is 0-100, honest. Explain it in one line.

Return ONLY JSON with this exact shape:
{
  "goal_summary": string,
  "north_star": string,               // the concrete outcome, ONE punchy sentence, max 14 words, ends with a deadline
  "game_plan": [ { "step": number, "title": string, "who": string, "ask": string, "why": string } ],  // exactly 4 steps; title max 4 words; who/ask max 12 words each
  "people": [ {
     "name": string, "headline": string, "step": number, "url": string, "linkedin_url": string, "photo_url": string,
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
- The GOAL is a hard filter. Every item must satisfy every constraint stated in it: region or city, field, time of year, type of opportunity. If the goal says Europe, every item is in Europe. Never pad the list with near misses from another region, field or season.
- ABOUT ME is a hard eligibility filter. Only include opportunities this student can apply to at their level and class year. An undergraduate sees only undergraduate opportunities: never graduate, PhD, postdoc or experienced-hire roles.
- Return up to 8 items, best fit first. Return fewer rather than include one that breaks a rule above.
- deadline: YYYY-MM-DD when you found it (must be after today), else null. deadline_note: a short plain fact such as "Rolling" or "Opens in January".
Return ONLY JSON:
{ "opportunities": [ {
   "title": string, "org": string, "type": "internship"|"job"|"research"|"fellowship"|"program",
   "location": string, "deadline": string|null, "deadline_note": string,
   "url": string, "domain": string,        // the organization's OWN website domain for its logo, e.g. "x.ai", "goldmansachs.com", "yale.edu" (never a job board)
   "pitch": string,                         // 1 punchy line on why it's great, max 16 words
   "yale_tie": string, "fit": number          // 0-100 fit for this student
} ] }`;

const DETAIL_SYSTEM = `You help a Yale student apply to ONE specific opportunity. Research it (official page, Yale OCS, employer events, public posts) and return what they need to act.
Rules:
- people: 3-5 real people the student should contact about THIS opportunity, found by search: the program director or coordinator, the faculty lead, a recruiter, Yale alumni or current students who did it. Real full names and titles from pages you found, with that page's url. name is the person's full name only: never a role, an office or a team. linkedin_url is their own LinkedIn profile (linkedin.com/in/...) when that exact URL appeared in your results, else "". photo_url is the direct URL of their headshot image when one appeared in your results, else "". For each: why they matter, one specific ask, and a message under 90 words. Return fewer if fewer real people can be found; never a placeholder.
- events: real upcoming dates only (after today): application deadline(s), info sessions, office hours, employer/Yale OCS events, networking events, recruiter coffee chats. Only include an event when you found its date (YYYY-MM-DD); set verified=true only if you saw the date on an official/primary source and include its url.
- checklist: 5-9 concrete, ordered steps to submit a strong application (materials, essays, recommenders, outreach, prep). Short imperative text.
- next_actions: the 3 most important things to do THIS WEEK.
- messages: 1-3 short drafts (under 90 words) to real or role-described people who can help (Yale alumni at the org, the program contact, a professor). One specific ask each. Never invent quotes.
- keywords: 8-15 skills/terms the application and resume should reflect.
Return ONLY JSON:
{ "summary": string, "eligibility": string,
  "people": [ { "name": string, "role": string, "yale_tie": string, "why": string, "url": string, "linkedin_url": string, "photo_url": string, "ask": string, "subject": string, "message": string } ],
  "events": [ { "title": string, "kind": "deadline"|"info_session"|"office_hours"|"event"|"coffee_chat", "date": string|null, "time": string, "url": string, "verified": boolean } ],
  "checklist": [ { "id": string, "text": string, "kind": "application"|"outreach"|"prep" } ],
  "next_actions": [string],
  "messages": [ { "to": string, "why": string, "subject": string, "body": string } ],
  "keywords": [string] }`;

const RESUME_PARSE_SYSTEM = `Convert a student's resume text (and, when given, their LinkedIn profile text) into structured JSON. Copy facts exactly; do NOT invent, embellish, or add numbers. Merge LinkedIn-only items into "other" or the right section and mark them with "source":"linkedin".
Give every item and bullet a short unique id (e.g. "e1", "e1b2").
"about" is a 2-3 sentence summary of the student, max 60 words: school, class year and majors; the two or three most significant things they have done; their strongest skills. Use only facts in the text.
Return ONLY JSON:
{ "name": string, "contact": { "email": string, "phone": string, "location": string, "links": [string] },
  "summary": string, "about": string,
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

const parseJSON = (s) => {
  const m = String(s || "").match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : s);
};

// One model request. Returns the final answer text and how many web searches ran.
async function ask(system, user, { tools, ms, model = MODEL_SEARCH }) {
  const messages = [{ role: "user", content: user }];
  const t0 = Date.now();
  let searches = 0;
  for (let turn = 0; ; turn++) {
    const res = await claude.beta.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: EFFORT },
      ...(hasFallbacks(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      system: `${system}\n\n${VOICE}`,
      messages,
      ...(tools ? { tools } : {}),
    }, { timeout: ms });
    searches += res.content.filter((c) => c.type === "server_tool_use" && c.name === "web_search").length;
    // A long search turn can pause; sending it back as-is makes the server resume it.
    if (res.stop_reason === "pause_turn" && turn < 3) {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    if (res.stop_reason === "refusal") throw new Error("Bulldog couldn’t answer that one. Try rephrasing it.");
    if (res.stop_reason === "max_tokens") throw new Error("That one ran too long. Try a narrower goal.");
    // The answer is the text after the last search result; earlier text is commentary between searches.
    let text = [];
    for (const c of res.content) {
      if (c.type === "text") text.push(c.text);
      else if (c.type === "server_tool_use" || /tool_result$/.test(c.type)) text = [];
    }
    console.log(`[model] ${res.model || model} · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${searches} searches · ${tools ? "search" : "plain"}`);
    return { text: text.join(""), searches, model: res.model || model };
  }
}

// Ask the model for JSON with live web search; fall back to a plain call if search fails.
async function claudeJSON(system, user, searchHint) {
  const sys = `${system}\n\nToday is ${today()}.`;
  try {
    const out = await ask(`${sys}\n\n${searchHint} Keep it to a few searches. Output the JSON object only.`, user, {
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      ms: 150000,
    });
    const json = parseJSON(out.text);
    json._meta = { model: out.model, live_search: out.searches > 0, searches: out.searches, demo: false };
    return json;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw e;
    console.error("live search failed, falling back:", e.message);
    const out = await ask(`${sys}\n\nOutput the JSON object only.`, user, { ms: 90000 });
    const json = parseJSON(out.text);
    json._meta = { model: out.model, live_search: false, demo: false };
    return json;
  }
}

// Plain JSON call, no search, on the cheap model (resume parsing / tailoring work only on what the student gave us).
async function claudePlain(system, user, ms = 120000) {
  const out = await ask(`${system}\n\nToday is ${today()}. Output the JSON object only.`, user, { ms, model: MODEL_FAST });
  return parseJSON(out.text);
}
// Plain text on the cheap model (Workspace drafts).
async function claudeText(system, user, ms = 90000) {
  return (await ask(`${system}\n\nToday is ${today()}.`, user, { ms, model: MODEL_FAST })).text.trim();
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
      { title: "Grok Summer Intern — Post-training", org: "SpaceXSI (example)", domain: "x.ai", type: "internship", location: "Palo Alto", deadline: `${y}-01-15`, deadline_note: "Rolling; early apps favored", url: "https://x.ai/careers", pitch: "Ship RL evals on a frontier model your first week.", yale_tie: "3 Yale NLP Lab alumni on team", fit: 90 },
      { title: "Undergrad RA — NLP & Agents Lab", org: "Yale CS (example)", domain: "yale.edu", type: "research", location: "New Haven", deadline: `${y}-02-01`, deadline_note: "Email PI with a 1-page proposal", url: "https://cpsc.yale.edu", pitch: "Co-author a benchmark paper before junior year.", yale_tie: "On campus", fit: 84 },
      { title: "Tsai CITY Summer Fellowship", org: "Yale Tsai CITY (example)", domain: "city.yale.edu", type: "fellowship", location: "New Haven", deadline: `${y}-03-01`, deadline_note: "Funding for student ventures", url: "https://city.yale.edu", pitch: "Get paid to keep building tonight's hack all summer.", yale_tie: "Yale program", fit: 78 },
      { title: "Applied AI Engineer Intern", org: "AI startup (example)", domain: "anthropic.com", type: "internship", location: "NYC", deadline: null, deadline_note: "Rolling", url: "https://www.ycombinator.com/jobs", pitch: "Small team, real ownership, Yale '22 founder.", yale_tie: "Founder is Yale '22", fit: 72 },
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
const AUTH = !!(SB_URL && SB_ANON && SB_SERVICE) && process.env.AUTH_OFF !== "1"; // AUTH_OFF=1 for local testing only
const DOMAIN = (process.env.ALLOWED_DOMAIN || "yale.edu").toLowerCase();
const LIMITS = {
  plan: +process.env.DAILY_PLAN_LIMIT || 10,
  deck: +process.env.DAILY_DECK_LIMIT || 15,
  detail: +process.env.DAILY_DETAIL_LIMIT || 40, // opportunity research when added to cart
  tailor: +process.env.DAILY_TAILOR_LIMIT || 20,
  parse: +process.env.DAILY_PARSE_LIMIT || 6,
  draft: +process.env.DAILY_DRAFT_LIMIT || 40, // Workspace AI rewrites (Haiku)
};
const MONTHLY_CAP = +process.env.MONTHLY_CALL_CAP || 3000; // total model calls across all users per month
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
function readBody(req, max = 600e3) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > max) { reject(new HttpError(413, "Request too large")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}
const clip = (s, n) => String(s || "").slice(0, n);

// ---------------- cart / resume helpers ----------------
const { ics } = require("./lib/ics");
const store = require("./lib/store")({ AUTH, sb, root: __dirname });
const linkedin = require("./lib/linkedin");
const records = require("./lib/records")({ AUTH, sb, root: __dirname });
require("./lib/semantic").warm(); // free local meaning model; loads in the background
const bootApi = require("./lib/boot")({ records, store, guard, readBody, send, HttpError, ai: AI ? { write: claudeText, bump, model: MODEL_FAST } : null, AI_OFF });
const CART_STATUSES = ["saved", "applying", "submitted", "interview", "offer", "dropped"];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

function sanitizeOpp(o = {}) {
  const deadline = isDate(o.deadline) && o.deadline >= today() ? o.deadline : null;
  return {
    title: clip(o.title, 200), org: clip(o.org, 160), type: clip(o.type, 30), location: clip(o.location, 120),
    domain: /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(o.domain || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) ? String(o.domain).replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase().slice(0, 80) : "",
    deadline, deadline_note: clip(o.deadline_note, 200), url: /^https?:\/\//.test(o.url || "") ? clip(o.url, 500) : "",
    pitch: clip(o.pitch, 300), yale_tie: clip(o.yale_tie, 200), fit: Math.max(0, Math.min(100, +o.fit || 0)),
  };
}

function publicBase(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0];
  return `${proto}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

// Who the student is, in a few lines, from what they saved: profile answers plus their resume.
async function studentBrief(uid) {
  const [p, r] = await Promise.all([store.profileGet(uid).catch(() => null), store.resumeGet(uid).catch(() => null)]);
  const b = r?.base, ed = b?.education?.[0];
  return [b?.name && `Name: ${b.name}`, p?.year && `${p.year} at Yale`, ed && [ed.degree, ed.school, ed.dates].filter(Boolean).join(", "), b?.about,
    p?.fields?.length && `Interests: ${p.fields.join(", ")}`, p?.summer_goal && `Goal: ${p.summer_goal}`].filter(Boolean).join("\n");
}

// Research one cart item (events, checklist, messages) in the background; never throws.
async function enrich(user, item) {
  if (!AI && !DEMO) return store.cartUpdate(user.id, item.id, { detail: { error: AI_OFF } }).catch(() => {});
  try {
    await bump(user, "detail");
    const detail = DEMO ? demoDetail(item.opp) : await claudeJSON(DETAIL_SYSTEM, `OPPORTUNITY:\n${JSON.stringify(item.opp)}\n\nSTUDENT (write every message as this student, using these facts; never leave a bracketed placeholder):\n${(await studentBrief(user.id)) || "A Yale undergraduate."}`, "Use web_search (official page, staff and people pages, ocs.yale.edu, events.yale.edu) to find real deadlines, info sessions, and the named people who run it.");
    if (DEMO) detail.people ||= [
      { name: "Maya Chen", role: "Program coordinator (example)", yale_tie: "Yale ’24 · Silliman", why: "Runs intake and answers applicant questions.", url: "", ask: "A 15-minute call about what makes an application stand out", subject: "Quick question before I apply", message: "Hi Maya — I’m a Yale sophomore applying this cycle. Could I ask you two questions about what the committee looks for? Fifteen minutes any day next week works for me." },
      { name: "Jordan Patel", role: "Alum of the program (example)", yale_tie: "Yale ’21", why: "Did this exact program and can describe the day-to-day.", url: "", ask: "What they would do differently in the application", subject: "Yale student applying to your old program", message: "Hi Jordan — I’m a Yale sophomore applying to the program you did in 2020. What’s one thing you’d do differently in the application? A short reply would help a lot." },
    ];
    detail.people = (detail.people || []).filter((p) => p && (DEMO ? cleanName(p.name) : isPerson(p.name))).slice(0, 6).map((p, i) => ({ id: "p" + i, name: clip(cleanName(p.name), 120), role: clip(p.role, 160), yale_tie: clip(p.yale_tie, 120), why: clip(p.why, 240), ...personLinks(p), ask: clip(p.ask, 200), subject: clip(p.subject, 200), message: clip(p.message, 1200) }));
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
    about: clip(r.about, 500),
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
        return send(res, 200, { ai: AI, demo: DEMO, model: MODEL, models: { search: MODEL_SEARCH, fast: MODEL_FAST }, emailCode: process.env.AUTH_EMAIL_CODE === "1", auth: AUTH, domain: DOMAIN, limits: LIMITS, supabaseUrl: AUTH ? SB_URL : null, supabaseAnonKey: AUTH ? SB_ANON : null, linkedin: linkedin.configured });
      }
      if (req.method === "POST" && url === "/api/plan") {
        const user = await guard(req);
        if (!AI && !DEMO) throw new HttpError(503, AI_OFF);
        const b = await readBody(req);
        if (!b.goal) return send(res, 400, { error: "Tell us your goal first." });
        const input = { goal: clip(b.goal, 300), about: clip(b.about, 1500), profiles: clip(b.profiles, 12000), liked: (Array.isArray(b.liked) ? b.liked : []).slice(0, 12) };
        const usage = await bump(user, "plan");
        const plan = DEMO ? demoPlan(input.goal) : await claudeJSON(PLAN_SYSTEM, planPrompt(input), "Use web_search to find the real, named people, their LinkedIn profiles, and recent public posts, articles or news for hooks. Hook sources should include the URL when you have one.");
        if (!DEMO) plan.people = (plan.people || []).filter((p) => p && isPerson(p.name)).map((p) => ({ ...p, name: cleanName(p.name), ...personLinks(p) }));
        if (AUTH) {
          const [row] = await sb("plans", { method: "POST", prefer: "return=representation", body: { user_id: user.id, goal: input.goal, liked: input.liked, data: plan } });
          plan._id = row.id;
        }
        plan._usage = usage;
        return send(res, 200, plan);
      }
      if (req.method === "POST" && url === "/api/opportunities") {
        const user = await guard(req);
        if (!AI && !DEMO) throw new HttpError(503, AI_OFF);
        const b = await readBody(req);
        if (!b.goal) return send(res, 400, { error: "Tell us your goal first." });
        const usage = await bump(user, "deck");
        if (DEMO) return send(res, 200, { ...demoOpps(), _usage: usage });
        const prompt = `GOAL: ${clip(b.goal, 300)}\n\nABOUT ME: ${clip(b.about, 1500) || "(not given)"}\n\nALREADY SEEN (don't repeat): ${(Array.isArray(b.seen) ? b.seen : []).slice(0, 40).map((s) => clip(s, 120)).join("; ") || "(none)"}`;
        const d = await claudeJSON(OPPS_SYSTEM, prompt, "Use web_search to find real openings with real URLs and deadlines.");
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

      // ---------------- profile (onboarding answers) ----------------
      if (url === "/api/profile" && req.method === "GET") {
        const user = await guard(req);
        return send(res, 200, { profile: await store.profileGet(user.id), email: user.email });
      }
      if (url === "/api/profile" && req.method === "PUT") {
        const user = await guard(req);
        const b = await readBody(req);
        const list = (v, n) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => clip(x, 60));
        const profile = {
          fields: list(b.fields, 12), year: clip(b.year, 30), looking_for: list(b.looking_for, 8), locations: list(b.locations, 8),
          summer_goal: clip(b.summer_goal, 400), people: clip(b.people, 4000), onboarded: !!b.onboarded,
        };
        return send(res, 200, { profile: await store.profileSave(user.id, profile) });
      }

      // ---------------- Boot Outreach workspace (/workspace) ----------------
      if (url.startsWith("/api/boot/")) { await bootApi(req, res, url); return; }

      // ---------------- LinkedIn (connected through Composio) ----------------
      if (url === "/api/linkedin" && req.method === "GET") {
        const user = await guard(req);
        return send(res, 200, await linkedin.status(user.id));
      }
      if (url === "/api/linkedin/connect" && req.method === "POST") {
        const user = await guard(req);
        return send(res, 200, await linkedin.connect(user.id, publicBase(req) + "/linkedin/callback"));
      }
      if (url === "/api/linkedin" && req.method === "DELETE") {
        const user = await guard(req);
        return send(res, 200, await linkedin.disconnect(user.id));
      }
      if (url === "/linkedin/callback" && req.method === "GET") {
        const q = new URLSearchParams(req.url.split("?")[1] || "");
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        return res.end(linkedin.callbackPage(q.get("status") !== "failed"));
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
          if (Array.isArray(b.done)) patch.done = b.done.slice(0, 80).map((x) => clip(x, 40));
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
        if (!AI && !DEMO) throw new HttpError(503, AI_OFF);
        await bump(user, "parse");
        const base = DEMO ? demoResume() : await claudePlain(RESUME_PARSE_SYSTEM, `RESUME TEXT:\n${resumeText || "(none)"}\n\nLINKEDIN PROFILE:\n${linkedinText || "(none)"}`);
        const saved = await store.resumeSave(user.id, { base: normalizeResume(base), source_names: (b.source_names || []).slice(0, 4).map((s) => clip(s, 120)) });
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
          if (!AI && !DEMO) throw new HttpError(503, AI_OFF);
          await bump(user, "tailor");
          const existing = await store.tailoredGet(user.id, item.id);
          const current = existing?.resume || r.base;
          const out = DEMO ? demoTailor(current) : await claudePlain(TAILOR_SYSTEM, `TARGET OPPORTUNITY:\n${JSON.stringify(item.opp)}\n\nWHAT THEY LOOK FOR:\n${JSON.stringify({ summary: item.detail?.summary, eligibility: item.detail?.eligibility, keywords: item.detail?.keywords })}\n\nRESUME (JSON):\n${JSON.stringify(current)}`);
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
    const file = path.join(__dirname, "public", url === "/" ? "index.html" : url === "/app" || url === "/auth/confirm" ? "app.html" : url === "/workspace" ? "workspace.html" : url);
    if (!file.startsWith(path.join(__dirname, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`Bulldog Reach on http://localhost:${PORT}  (${AI ? `AI on · search: ${MODEL_SEARCH} · reading/writing: ${MODEL_FAST}` : DEMO ? "DEMO_MODE: fake sample data" : "AI off — no ANTHROPIC_API_KEY (workspace is free)"} · ${AUTH ? "Yale login ON" : "open mode, no login"})`));
