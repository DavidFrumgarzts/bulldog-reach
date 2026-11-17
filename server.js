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

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}

http
  .createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    try {
      if (req.method === "POST" && url === "/api/plan") {
        const b = await readBody(req);
        if (!b.goal) return send(res, 400, { error: "Tell us your goal first." });
        if (DEMO) return setTimeout(() => send(res, 200, demoPlan(b.goal)), 900);
        return send(res, 200, await grokJSON(PLAN_SYSTEM, planPrompt(b), "Use x_search and web_search to find real, recent posts for hooks. Hook sources should include the post URL when you have one."));
      }
      if (req.method === "POST" && url === "/api/opportunities") {
        const b = await readBody(req);
        if (!b.goal) return send(res, 400, { error: "Tell us your goal first." });
        if (DEMO) return setTimeout(() => send(res, 200, demoOpps()), 700);
        const user = `GOAL: ${b.goal}\n\nABOUT ME: ${b.about || "(not given)"}\n\nALREADY SEEN (don't repeat): ${(b.seen || []).join("; ") || "(none)"}`;
        return send(res, 200, await grokJSON(OPPS_SYSTEM, user, "Use web_search (and x_search for fresh hiring posts) to find real openings with real URLs and deadlines."));
      }
      if (url === "/api/status") return send(res, 200, { demo: DEMO, model: MODEL });
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: e.message });
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
  .listen(PORT, () => console.log(`Bulldog Reach on http://localhost:${PORT}  (${DEMO ? "DEMO mode — add XAI_API_KEY to .env" : "model " + MODEL})`));
