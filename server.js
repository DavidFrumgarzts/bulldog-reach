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
const LIMITS = { plan: +process.env.DAILY_PLAN_LIMIT || 10, deck: +process.env.DAILY_DECK_LIMIT || 15 };
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
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
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
      if (body.length > 200e3) { reject(new HttpError(413, "Request too large")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}
const clip = (s, n) => String(s || "").slice(0, n);

http
  .createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    try {
      if (url === "/api/config" || url === "/api/status") {
        return send(res, 200, { demo: DEMO, model: MODEL, auth: AUTH, domain: DOMAIN, limits: LIMITS, supabaseUrl: AUTH ? SB_URL : null, supabaseAnonKey: AUTH ? SB_ANON : null });
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
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message });
    }
    const file = path.join(__dirname, "public", url === "/" ? "index.html" : url);
    if (!file.startsWith(path.join(__dirname, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`Bulldog Reach on http://localhost:${PORT}  (${DEMO ? "DEMO mode — add XAI_API_KEY to .env" : "model " + MODEL} · ${AUTH ? "Yale login ON" : "open mode, no login"})`));
