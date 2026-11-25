// Boot Outreach workspace API: /api/boot/*
// Free by design: no model calls, no paid services. Discovery uses public ATS feeds; materials come from the
// user's own claims ledger. Optional Apollo people search only runs if the user sets their own APOLLO_API_KEY.
const ats = require("./ats");
const fit = require("./fit");
const mat = require("./materials");
const SEED = require("./companies");

const STAGES = ["discovered", "researching", "shortlisted", "preparing", "ready_for_review", "submitted", "assessment", "interview", "offer", "rejected", "withdrawn", "archived"];
const CLAIM_STATUS = ["unreviewed", "verified", "approximate", "needs_evidence", "omit"];
const SECTIONS = ["education", "experience", "project", "leadership", "skill", "other"];
const OUT_STATUS = ["draft", "approved", "sent", "replied", "meeting", "referred", "no_reply", "opted_out"];
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const clip = (s, n) => String(s ?? "").slice(0, n);
const list = (v, n, m = 80) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => clip(x, m)).filter(Boolean);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

module.exports = function makeBoot({ records: R, store, guard, readBody, send, HttpError, ai = null, AI_OFF = "AI is off." }) {
  // ---------- helpers ----------
  async function profileOf(uid) {
    const saved = await R.get(uid, "profile", "me");
    if (saved) return saved;
    const base = { id: "me", preferences: {}, eligibility: {}, corrections: [], exclusions: [], boards: [], seed_disabled: [] };
    // First visit: prefill from the main app's onboarding answers (nothing is saved until the user presses Save).
    const ob = await store.profileGet(uid).catch(() => null);
    if (!ob) return base;
    const LOC = { "New York": "NYC", "Bay Area": "Bay Area", Boston: "Boston", DC: "Washington", "New Haven": "New Haven" };
    const FIELD_FAM = { "Software / Tech": "swe", "STEM research": "research", "Startups / VC": "ops", Consulting: "ops" };
    const fields = ob.fields || [], locs = ob.locations || [];
    return {
      ...base, from_onboarding: true, school: "Yale University", year_label: String(ob.year || "").toLowerCase(),
      preferences: {
        role_families: [...new Set(fields.map((f) => FIELD_FAM[f]).filter(Boolean))],
        industries: fields.includes("AI / ML") ? ["ai"] : [],
        locations: locs.includes("Anywhere") ? [] : locs.map((l) => LOC[l]).filter(Boolean),
        include_remote: locs.includes("Remote") || locs.includes("Anywhere") || !locs.length,
        company_stages: fields.includes("Startups / VC") ? ["startup"] : [],
        learning_goals: ob.summer_goal || "", priorities: {},
      },
    };
  }
  const companiesFor = (p) => [...SEED.filter((c) => !(p.seed_disabled || []).includes(`${c.ats}:${c.board}`)), ...(p.boards || [])];
  const summary = (o) => { const { description, ...rest } = o; return { ...rest, snippet: clip(description, 400) }; };
  const need = (cond, code, msg) => { if (!cond) throw new HttpError(code, msg); };

  function sanitizePrefs(p = {}) {
    const pr = p.priorities || {};
    return {
      role_families: list(p.role_families, 12, 20).filter((f) => fit.FAMILIES[f]),
      industries: list(p.industries, 6, 20), locations: list(p.locations, 10, 60), include_remote: p.include_remote !== false,
      work_arrangement: list(p.work_arrangement, 3, 20), term: clip(p.term, 30),
      start_date: isDate(p.start_date) ? p.start_date : "", end_date: isDate(p.end_date) ? p.end_date : "",
      days_per_week: clip(p.days_per_week, 10), comp_min: clip(p.comp_min, 40), company_stages: list(p.company_stages, 3, 20),
      learning_goals: clip(p.learning_goals, 1000),
      priorities: Object.fromEntries(["startup", "product_gtm", "robotics", "brand", "compensation", "location"].map((k) => [k, Math.max(0, Math.min(3, +pr[k] || 0))])),
    };
  }
  // Eligibility facts are stored ONLY when the user ticks "I confirm". Changing a value resets its confirmed_on date.
  function sanitizeElig(next = {}, prev = {}) {
    const out = {};
    for (const k of ["citizenship", "visa_status", "work_authorization", "cpt", "opt", "school", "academic_term", "restrictions"]) {
      const f = next[k];
      if (!f || !f.confirmed || !String(f.value || "").trim()) continue;
      const value = clip(f.value, 300);
      out[k] = { value, confirmed_on: prev[k]?.value === value && prev[k]?.confirmed_on ? prev[k].confirmed_on : today(), evidence: clip(f.evidence, 300) };
    }
    return out;
  }
  function sanitizeClaim(c = {}, prev = {}) {
    const status = CLAIM_STATUS.includes(c.status) ? c.status : prev.status || "unreviewed";
    const wording = clip(c.preferred_wording ?? prev.preferred_wording, 600);
    const history = [...(prev.history || [])];
    if (prev.id && (prev.preferred_wording !== wording || prev.status !== status)) history.push({ at: nowIso(), status: prev.status, preferred_wording: prev.preferred_wording });
    return {
      id: prev.id || c.id, section: SECTIONS.includes(c.section) ? c.section : prev.section || "experience",
      org: clip(c.org ?? prev.org, 160), title: clip(c.title ?? prev.title, 160), dates: clip(c.dates ?? prev.dates, 80), location: clip(c.location ?? prev.location, 120),
      text: clip(c.text ?? prev.text, 600), preferred_wording: wording, status,
      source: clip(c.source ?? prev.source ?? "you", 120), evidence: clip(c.evidence ?? prev.evidence, 400),
      skills: c.skills ? list(c.skills, 20, 60) : prev.skills || [], tags: c.tags ? list(c.tags, 12, 40) : prev.tags || [],
      confirmed_on: status === "verified" ? (prev.status === "verified" && prev.preferred_wording === wording ? prev.confirmed_on : today()) : null,
      order: Number.isFinite(+c.order) ? +c.order : prev.order ?? 0, history: history.slice(-20),
    };
  }
  function blockers(app, opp) {
    if (STAGES.indexOf(app.stage) >= STAGES.indexOf("submitted")) return []; // nothing blocks work that's already submitted or closed
    const b = [];
    if (opp) {
      if (opp.status === "closed") b.push("Posting looks closed.");
      else if (opp.status !== "open") b.push("Posting status unclear: re-check it.");
      const age = (Date.now() - new Date(opp.last_checked || 0)) / 864e5;
      if (age > 7) b.push(`Posting last checked ${Math.floor(age)} days ago.`);
      if (opp.fit?.eligibility && ["not_stated", "possible_conflict", "check", "asks_authorization"].includes(opp.fit.eligibility.state)) b.push(`Eligibility: ${opp.fit.eligibility.label}.`);
    }
    if (!app.deadline?.date) b.push("No deadline recorded.");
    if (!app.next_action) b.push("No next action.");
    if (["preparing", "ready_for_review"].includes(app.stage)) b.push(...mat.unresolved(app));
    return b;
  }
  function setStage(app, to, note) {
    if (!STAGES.includes(to) || app.stage === to) return app;
    app.history = [...(app.history || []), { at: nowIso(), type: "stage", from: app.stage, to, note: clip(note, 300) }];
    app.stage = to;
    return app;
  }
  const log = (app, type, note) => { app.history = [...(app.history || []), { at: nowIso(), type, note: clip(note, 300) }]; return app; };

  async function upsertOpp(uid, o, fitResult, runId) {
    const prev = await R.get(uid, "opp", o.id);
    const merged = { ...prev, ...o, description: clip(o.description, 20000), user_state: prev?.user_state || "new", first_seen: prev?.first_seen || nowIso(), last_run: runId || prev?.last_run || null, notes: prev?.notes || "" };
    merged.fit = fitResult;
    return R.put(uid, "opp", merged);
  }
  async function ensureApp(uid, opp) {
    const apps = await R.list(uid, "app");
    const found = apps.find((a) => a.opp_id === opp.id);
    if (found) return found;
    const dl = opp.evidence?.deadline;
    const app = {
      opp_id: opp.id, title: opp.title, company: opp.company, url: opp.canonical_url, stage: "shortlisted",
      deadline: dl?.value && isDate(dl.value) ? { date: dl.value, source: "posting", confidence: dl.confidence, quote: dl.quote || "", firm: dl.confidence === "high" } : null,
      next_action: "Review the posting and eligibility", follow_up: "", expected_schedule: "", contact_ids: [], notes: "", materials: { questions: [] },
      history: [{ at: nowIso(), type: "stage", from: null, to: "shortlisted", note: "Saved from discovery" }],
    };
    return R.put(uid, "app", app);
  }

  // Resume version for one role, built line by line from usable claims; each line keeps its claim id.
  async function resumeFromClaims(profile, claims, opp) {
    const use = claims.filter(fit.usable);
    // Order roles and bullets by how close each claim is in meaning to this role (no reordering for the base version).
    const relMap = new Map(opp ? (await fit.support(`${opp.title}. ${opp.department || ""}. ${(opp.evidence?.required_qualifications?.value || []).join(" ")}`, claims, 999).catch(() => [])).map((x) => [x.id, x.similarity]) : []);
    const rel = (c) => relMap.get(c.id) || 0;
    const head = [profile.name || "[Your name]", [profile.email, profile.phone, profile.location, profile.links].filter(Boolean).join(" · ")].filter(Boolean);
    const lines = [...head, ""];
    const ids = [];
    const groups = (sec) => {
      const g = new Map();
      for (const c of use.filter((c) => c.section === sec)) { const k = `${c.org}|${c.title}|${c.dates}`; if (!g.has(k)) g.set(k, []); g.get(k).push(c); }
      return [...g.values()].sort((a, b) => Math.max(...b.map(rel)) - Math.max(...a.map(rel)) || (a[0].order - b[0].order));
    };
    for (const [sec, label] of [["education", "EDUCATION"], ["experience", "EXPERIENCE"], ["leadership", "LEADERSHIP"], ["project", "PROJECTS"]]) {
      const gs = groups(sec);
      if (!gs.length) continue;
      lines.push(label);
      for (const g of gs) {
        const c0 = g[0];
        lines.push([c0.title, c0.org].filter(Boolean).join(", ") + (c0.dates ? ` — ${c0.dates}` : ""));
        for (const c of [...g].sort((a, b) => rel(b) - rel(a)).slice(0, 4)) { if (c.preferred_wording || c.text) { lines.push("• " + (c.preferred_wording || c.text)); ids.push(c.id); } }
      }
      lines.push("");
    }
    const skills = use.filter((c) => c.section === "skill");
    if (skills.length) { lines.push("SKILLS", ...skills.map((c) => `${c.title ? c.title + ": " : ""}${(c.skills || []).join(", ") || c.preferred_wording || c.text}`)); ids.push(...skills.map((c) => c.id)); }
    const text = mat.applyCorrections(lines.join("\n").trim(), profile.corrections);
    return { text, claim_ids: ids, flags: mat.flagsFor(text, { claims, profile, usedClaimIds: ids }) };
  }

  function setArtifact(app, key, a) {
    app.materials = app.materials || { questions: [] };
    const prev = key.startsWith("q:") ? (app.materials.questions || []).find((q) => "q:" + q.id === key) : app.materials[key];
    const versions = [...(prev?.versions || [])];
    if (prev?.text && prev.text !== a.text) versions.push({ at: prev.updated_at || nowIso(), text: prev.text, approved_at: prev.approved_at || null });
    const next = { ...prev, ...a, updated_at: nowIso(), approved_at: null, acknowledged: [], versions: versions.slice(-15) };
    if (key.startsWith("q:")) { next.answer = next.text; app.materials.questions = (app.materials.questions || []).map((q) => ("q:" + q.id === key ? next : q)); }
    else app.materials[key] = next;
    return next;
  }
  const getArtifact = (app, key) => (key.startsWith("q:") ? (app.materials?.questions || []).find((q) => "q:" + q.id === key) : app.materials?.[key]);

  // LinkedIn "Download your data" → Connections.csv (First Name, Last Name, URL, Email Address, Company, Position, Connected On).
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // ---------- optional AI rewrite (cheap model, paid per use; only when the user clicks it) ----------
  // The model may only reword the facts it is given. The usual flags run on its output afterwards.
  const REWRITE_SYSTEM = `You rewrite a student's draft so it reads naturally and specifically. Hard rules:
- Use ONLY the facts under FACTS and the role details given. Do not add any experience, skill, metric, number, title, date, award or claim that is not there.
- Facts marked [approximate] must stay vague: no exact numbers for them.
- Keep every [bracketed placeholder] that asks for something you were not told (for example why this company). Do not invent an answer for it.
- No flattery, no clichés ("passionate", "synergy", "I am writing to express"), no em dashes.
- Return only the final text, nothing else.`;
  const factLines = (ids, claims) => ids.map((id) => claims.find((c) => c.id === id)).filter(Boolean)
    .map((c) => `- ${c.preferred_wording || c.text}${c.org || c.title || c.dates ? ` (${[c.title, c.org, c.dates].filter(Boolean).join(", ")})` : ""}${c.status === "approximate" ? " [approximate]" : ""}`).join("\n") || "(none)";
  async function aiRewrite(user, kind, a, { opp, profile, claims, question, contact, channel }) {
    need(ai, 503, AI_OFF);
    await ai.bump(user, "draft");
    const role = opp ? `ROLE: ${opp.title} at ${opp.company}\nWHAT THEY ASK FOR:\n${(opp.evidence?.required_qualifications?.value || []).slice(0, 6).map((r) => "- " + r).join("\n") || "(not listed)"}` : "";
    const me = `STUDENT: ${[profile.name, profile.year_label, profile.school, profile.majors].filter(Boolean).join(", ") || "(not given)"}`;
    const task = {
      cover_letter: "Rewrite this cover letter. Under 250 words, three short paragraphs plus sign-off.",
      question: `Answer this application question in the student's voice, under 150 words unless the question asks for more.\nQUESTION: ${question}`,
      outreach: channel === "linkedin" ? `Rewrite this LinkedIn connection note to ${contact?.name || "the contact"}. Hard limit: 300 characters total.` : `Rewrite this short email to ${contact?.name || "the contact"}${contact?.role ? ` (${contact.role})` : ""}. Under 120 words, one clear ask.`,
    }[kind];
    const model = ai.writingModel(profile.tier);
    let text = await ai.write(REWRITE_SYSTEM, `${task}\n\n${role}\n\n${me}\n\n${voiceBlock(profile)}FACTS:\n${factLines(a.claim_ids || [], claims)}\n\nDRAFT:\n${a.text}`, model);
    if (kind === "outreach" && channel === "linkedin") text = text.slice(0, 300);
    text = mat.applyCorrections(text, profile.corrections);
    return { ...a, text, flags: mat.flagsFor(text, { claims, profile, usedClaimIds: a.claim_ids || [] }), written_by: model };
  }
  // The student's own writing, so drafts sound like them. Style only: facts still come from claims.
  function voiceBlock(profile) {
    const v = profile.voice || {};
    if (!v.guide && !(v.samples || []).length) return "";
    const ex = (v.samples || []).slice(0, 2).map((x) => `"""${clip(x.text, 700)}"""`).join("\n");
    return `THE STUDENT'S VOICE (match their tone, rhythm and word choice; never copy facts, names or numbers from these samples):\n${v.guide ? "Style notes: " + v.guide + "\n" : ""}${ex ? "Excerpts:\n" + ex + "\n" : ""}\n`;
  }
  const VOICE_SYSTEM = `Describe how this person writes so someone else could imitate their style. Cover: tone, sentence length and rhythm, vocabulary and phrases they like, how they open and close, how formal they are, what they avoid. Do not mention any facts, names, numbers or topics from the samples. 120 words max, as short plain sentences.`;

  // ---------- optional Apollo people search (user's own key; the 0-credit search endpoint only) ----------
  async function apolloSearch({ company, domain, titles }) {
    const key = process.env.APOLLO_API_KEY;
    need(key, 400, "Apollo isn't set up. Add your own free APOLLO_API_KEY to .env (see docs/COSTS.md).");
    const body = { page: 1, per_page: 10, person_titles: list(titles, 8, 60) };
    if (domain) body.q_organization_domains_list = [clip(domain, 120)];
    else if (company) body.q_keywords = clip(company, 120);
    const r = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", { method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json", "Cache-Control": "no-cache" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const d = await r.json().catch(() => ({}));
    need(r.ok, 502, `Apollo error (${r.status}): ${clip(d.error || d.message || "", 200)}`);
    return (d.people || d.contacts || []).map((p) => ({
      name: clip(p.name || [p.first_name, p.last_name || p.last_name_obfuscated].filter(Boolean).join(" "), 120),
      role: clip(p.title, 160), company: clip(p.organization?.name || company, 160), profile_url: clip(p.linkedin_url, 300),
      source: "apollo", source_url: "https://app.apollo.io", verification: "unverified", email_status: "none",
    }));
  }

  // Search the tracked job boards, rank by meaning, store results and the run. Used by Discover and by Ask Bulldog.
  async function runSearch(uid, s) {
    const [profile, claims, opps] = await Promise.all([profileOf(uid), R.list(uid, "claim"), R.list(uid, "opp")]);
    let cos = companiesFor(profile);
    if (Array.isArray(s.companies)) cos = cos.filter((c) => s.companies.includes(`${c.ats}:${c.board}`));
    const fams = (s.role_families?.length ? s.role_families : profile.preferences?.role_families) || [];
    const keywords = list(s.keywords, 20, 60); // literal "title must contain" filter, only if you typed some
    const dismissed = opps.filter((o) => o.user_state === "dismissed").map((o) => o.id);
    const { opportunities, sources } = await ats.search(cos, { keywords, locations: s.locations || [], include_remote: s.include_remote !== false, level: s.level || "internship", exclude_ids: dismissed });
    const prof = { ...profile, preferences: { ...profile.preferences, role_families: fams, ...(s.term ? { term: s.term } : {}) } };
    const run = await R.put(uid, "run", { search_id: s.id || null, query: { name: s.name || "", query: s.query || "", keywords, locations: s.locations || [], include_remote: s.include_remote !== false, level: s.level || "internship", term: s.term || "" }, at: nowIso(), sources, result_ids: [], count: 0, excluded_dismissed: dismissed.length });
    const fits = await fit.assessMany(opportunities, prof, claims, { query: s.query || "" }); // rank by meaning (local model), one batch
    let picked = opportunities.map((o, i) => ({ o, f: fits[i] }));
    if (s.match_families) picked = picked.filter((x) => x.f.interest.score >= 35);
    const saved = [];
    for (const { o, f } of picked) saved.push(await upsertOpp(uid, o, f, run.id));
    saved.sort((a, b) => b.fit.rank - a.fit.rank);
    await R.put(uid, "run", { ...run, result_ids: saved.map((o) => o.id), count: saved.length });
    return { run_id: run.id, sources, method: fits[0]?.interest?.method || "meaning", filtered_out: opportunities.length - saved.length, opportunities: saved };
  }
  async function appsWithBlockers(uid) {
    const [apps, opps] = await Promise.all([R.list(uid, "app"), R.list(uid, "opp")]);
    const byId = new Map(opps.map((o) => [o.id, o]));
    return apps.map((a) => { const o = byId.get(a.opp_id); return { ...a, opp: o ? summary(o) : null, blockers: blockers(a, o) }; });
  }
  async function putApp(uid, b) {
    return R.put(uid, "app", { opp_id: null, title: clip(b.title, 200), company: clip(b.company, 160), url: clip(b.url, 500), stage: STAGES.includes(b.stage) ? b.stage : "researching",
      deadline: isDate(b.deadline) ? { date: b.deadline, source: b.deadline_source || "you", confidence: "medium", firm: false } : null, next_action: "", follow_up: "", contact_ids: [], notes: clip(b.notes, 4000), materials: { questions: [] },
      history: [{ at: nowIso(), type: "stage", from: null, to: b.stage || "researching", note: b.history_note || "Added by hand" }] });
  }
  async function putContact(uid, b) {
    return R.put(uid, "contact", { name: clip(b.name, 120), company: clip(b.company, 160), role: clip(b.role, 160), relationship: "", shared_context: "", profile_url: clip(b.profile_url, 300), channel: "linkedin", email: "", email_status: "none",
      source: clip(b.source || "manual", 40), source_url: clip(b.source_url, 300), verification: b.verification === "verified" ? "verified" : "unverified", follow_up: "", notes: clip(b.notes, 2000), opt_out: false, last_interaction: null });
  }

  const agent = ai ? require("./agent")({ ai, R, h: { profileOf, runSearch, summary, ensureApp, appsWithBlockers, putApp, putContact, usable: fit.usable } }) : null;

  // ---------- route handler ----------
  return async function handle(req, res, url) {
    if (!url.startsWith("/api/boot/")) return false;
    const user = await guard(req);
    const uid = user.id;
    const method = req.method;
    const body = method === "GET" || method === "HEAD" ? {} : await readBody(req, 6e6); // LinkedIn exports and imports can be a few MB
    const p = url.slice("/api/boot".length);
    let m;
    const ok = (o) => send(res, 200, o);

    // ----- profile + claims -----
    if (p === "/state" && method === "GET") {
      const [profile, claims] = await Promise.all([profileOf(uid), R.list(uid, "claim")]);
      return ok({ profile, claims: claims.sort((a, b) => a.order - b.order), families: Object.fromEntries(Object.entries(fit.FAMILIES).map(([k, v]) => [k, v.label])), stages: STAGES, claim_statuses: CLAIM_STATUS, seed_companies: SEED, integrations: { apollo: !!process.env.APOLLO_API_KEY, linq: false, ai: !!ai, ai_models: ai?.models || null, meaning_model: require("./semantic").status() } });
    }
    if (p === "/profile" && method === "PUT") {
      const prev = await profileOf(uid);
      const prof = {
        id: "me", name: clip(body.name, 120), email: clip(body.email, 160), phone: clip(body.phone, 40), location: clip(body.location, 120), links: clip(body.links, 300),
        school: clip(body.school, 120), majors: clip(body.majors, 160), grad: clip(body.grad, 40), year_label: clip(body.year_label, 60),
        preferences: sanitizePrefs(body.preferences), eligibility: sanitizeElig(body.eligibility, prev.eligibility),
        corrections: (Array.isArray(body.corrections) ? body.corrections : []).slice(0, 50).map((c) => ({ from: clip(c.from, 200), to: clip(c.to, 200) })).filter((c) => c.from),
        exclusions: list(body.exclusions, 50, 200),
        boards: (Array.isArray(body.boards) ? body.boards : []).slice(0, 60).filter((b) => ats.FEEDS[b.ats] && /^[\w.-]{1,80}$/.test(b.board || "")).map((b) => ({ name: clip(b.name || b.board, 80), ats: b.ats, board: b.board, stage: clip(b.stage, 20), tags: list(b.tags, 4, 20) })),
        seed_disabled: list(body.seed_disabled, 100, 100),
        notifications: { email_digest: !!body.notifications?.email_digest, calendar: body.notifications?.calendar !== false, linq: false },
        tier: body.tier === "pro" || body.tier === "basic" ? body.tier : prev.tier || "basic",
        voice: prev.voice || { samples: [], guide: "" },
      };
      return ok({ profile: await R.put(uid, "profile", prof) });
    }
    if (p === "/claims" && method === "POST") {
      const prev = body.id ? (await R.get(uid, "claim", body.id)) || {} : {};
      return ok({ claim: await R.put(uid, "claim", sanitizeClaim(body, prev)) });
    }
    if ((m = p.match(/^\/claims\/([\w-]+)$/)) && method === "DELETE") { await R.remove(uid, "claim", m[1]); return ok({ ok: true }); }
    if (p === "/claims/import-resume" && method === "POST") {
      const r = await store.resumeGet(uid);
      need(r?.base, 404, "No saved resume yet. Upload one in the main app (My resume) first, or add claims by hand.");
      const b = r.base, out = [];
      let order = 0;
      const push = (c) => out.push(sanitizeClaim({ ...c, status: "unreviewed", source: `resume upload${(r.source_names || []).length ? " (" + r.source_names.join(", ") + ")" : ""}`, order: order++ }));
      for (const e of b.education || []) { push({ section: "education", org: e.school, title: e.degree, dates: e.dates, location: e.location, text: [e.degree, e.school].filter(Boolean).join(", ") }); for (const x of e.bullets || []) push({ section: "education", org: e.school, title: e.degree, dates: e.dates, text: x.text }); }
      for (const [sec, arr] of [["experience", b.experience], ["leadership", b.leadership]]) for (const e of arr || []) for (const x of e.bullets?.length ? e.bullets : [{ text: e.role }]) push({ section: sec, org: e.org, title: e.role, dates: e.dates, location: e.location, text: x.text });
      for (const e of b.projects || []) for (const x of e.bullets || []) push({ section: "project", org: e.name, dates: e.dates, text: x.text });
      for (const s of b.skills || []) push({ section: "skill", title: s.label, skills: s.items, text: (s.items || []).join(", ") });
      const existing = new Set((await R.list(uid, "claim")).map((c) => `${c.org}|${c.text}`));
      let n = 0;
      for (const c of out) if (!existing.has(`${c.org}|${c.text}`)) { await R.put(uid, "claim", c); n++; }
      return ok({ imported: n });
    }

    // ----- Basic / Pro (which model writes) -----
    if (p === "/tier" && method === "PUT") {
      need(["basic", "pro"].includes(body.tier), 400, "Pick basic or pro.");
      const prof = await profileOf(uid);
      return ok({ profile: await R.put(uid, "profile", { ...prof, id: "me", tier: body.tier }) });
    }
    // ----- writing samples (voice) -----
    if (p === "/voice/samples" && method === "POST") {
      const prof = await profileOf(uid);
      const v = prof.voice || { samples: [], guide: "" };
      const text = clip(body.text, 6000).trim();
      need(text.length >= 200, 400, "Add a longer sample (at least a few sentences) so there's a voice to learn from.");
      need((v.samples || []).length < 5, 400, "You can keep up to 5 samples. Remove one first.");
      v.samples = [...(v.samples || []), { id: "v" + Date.now().toString(36), title: clip(body.title || "Sample", 120), text, added_at: nowIso() }];
      return ok({ profile: await R.put(uid, "profile", { ...prof, id: "me", voice: v }) });
    }
    if ((m = p.match(/^\/voice\/samples\/([\w-]+)$/)) && method === "DELETE") {
      const prof = await profileOf(uid);
      const v = prof.voice || { samples: [] };
      v.samples = (v.samples || []).filter((x) => x.id !== m[1]);
      return ok({ profile: await R.put(uid, "profile", { ...prof, id: "me", voice: v }) });
    }
    if (p === "/voice/analyze" && method === "POST") {
      need(ai, 503, AI_OFF);
      const prof = await profileOf(uid);
      const v = prof.voice || { samples: [] };
      need((v.samples || []).length, 400, "Add at least one writing sample first.");
      await ai.bump(user, "draft");
      const model = ai.writingModel(prof.tier);
      const guide = clip(await ai.write(VOICE_SYSTEM, v.samples.map((x, i) => `SAMPLE ${i + 1}:\n${x.text}`).join("\n\n"), model), 1200);
      return ok({ profile: await R.put(uid, "profile", { ...prof, id: "me", voice: { ...v, guide, guide_model: model, guide_at: nowIso() } }) });
    }
    if (p === "/voice/guide" && method === "PUT") {
      const prof = await profileOf(uid);
      return ok({ profile: await R.put(uid, "profile", { ...prof, id: "me", voice: { ...(prof.voice || { samples: [] }), guide: clip(body.guide, 1200) } }) });
    }
    // ----- Ask Bulldog (chat agent) -----
    if (p === "/chats" && method === "GET") return ok({ chats: (await R.list(uid, "chat")).map((c) => ({ id: c.id, title: c.title, updated_at: c.updated_at, turns: (c.display || []).length / 2 })) });
    if ((m = p.match(/^\/chats\/([\w-]+)$/)) && method === "GET") { const c = await R.get(uid, "chat", m[1]); need(c, 404, "Not found"); return ok({ chat: { id: c.id, title: c.title, display: c.display || [] } }); }
    if ((m = p.match(/^\/chats\/([\w-]+)$/)) && method === "DELETE") { await R.remove(uid, "chat", m[1]); return ok({ ok: true }); }
    if (p === "/chat" && method === "POST") {
      need(ai, 503, AI_OFF);
      need(clip(body.message, 4000).trim(), 400, "Type a message.");
      try { return ok(await agent.chat(uid, user, body.thread_id || null, body.message)); }
      catch (e) { if (e.status) throw new HttpError(e.status, e.message); throw e; }
    }

    // Free (no AI) import: one unreviewed claim per resume line. Headings set the section; short lines set the org/title context.
    if (p === "/claims/import-text" && method === "POST") {
      const text = clip(body.text, 60000);
      need(text.trim().length > 40, 400, "Couldn't read enough text from that file.");
      const SEC = [[/^(education|academics?)\b/i, "education"], [/^(work |professional |relevant )?experience|^employment/i, "experience"], [/^(leadership|activities|extracurricular|involvement|community)/i, "leadership"], [/^projects?\b/i, "project"], [/^(skills|technical skills|languages|interests|certifications)/i, "skill"]];
      const existing = new Set((await R.list(uid, "claim")).map((c) => (c.text || "").toLowerCase()));
      let section = "other", context = "", n = 0, order = 1000;
      const source = `${clip(body.source_name || "uploaded file", 100)} (imported without AI)`;
      for (let raw of text.split(/\n+/)) {
        const l = raw.replace(/\s+/g, " ").trim();
        if (!l || l.length < 3) continue;
        const head = SEC.find(([re]) => re.test(l) && l.length < 40);
        if (head) { section = head[1]; context = ""; continue; }
        const bullet = /^[•\-–●▪◦*·]\s*/.test(l);
        const t = l.replace(/^[•\-–●▪◦*·]\s*/, "");
        if (!bullet && t.length < 70 && section !== "skill") { context = t; continue; } // org / title / dates line
        if (t.length < 12 || existing.has(t.toLowerCase())) continue;
        existing.add(t.toLowerCase());
        await R.put(uid, "claim", sanitizeClaim({ section, org: clip(context, 160), text: t, preferred_wording: t, status: "unreviewed", source, order: order++, skills: section === "skill" ? t.split(/[,;|]/).map((x) => x.trim()).filter(Boolean).slice(0, 20) : [] }));
        n++;
      }
      return ok({ imported: n });
    }

    // ----- saved searches + discovery -----
    if (p === "/searches" && method === "GET") return ok({ searches: await R.list(uid, "search"), runs: (await R.list(uid, "run")).slice(0, 20) });
    if (p === "/searches/parse" && method === "POST") return ok({ parsed: fit.parseQuery(body.query) });
    if (p === "/searches" && method === "POST") {
      const s = {
        id: body.id, name: clip(body.name || body.query || "My search", 120), query: clip(body.query, 500),
        keywords: list(body.keywords, 20, 60), match_families: !!body.match_families, role_families: list(body.role_families, 12, 20).filter((f) => fit.FAMILIES[f]),
        locations: list(body.locations, 10, 60), include_remote: body.include_remote !== false, level: ["internship", "early", "any"].includes(body.level) ? body.level : "internship",
        companies: body.companies === "all" || !Array.isArray(body.companies) ? "all" : list(body.companies, 100, 100), term: clip(body.term, 30),
      };
      return ok({ search: await R.put(uid, "search", s) });
    }
    if ((m = p.match(/^\/searches\/([\w-]+)$/)) && method === "DELETE") { await R.remove(uid, "search", m[1]); return ok({ ok: true }); }
    if (p === "/search/run" && method === "POST") {
      const s = body.search_id ? await R.get(uid, "search", body.search_id) : body;
      need(s, 404, "Saved search not found.");
      const r = await runSearch(uid, s);
      return ok({ ...r, opportunities: r.opportunities.map(summary) });
    }
    if (p === "/opps" && method === "GET") {
      const q = new URLSearchParams(req.url.split("?")[1] || "");
      const st = q.get("state") || "all";
      const opps = (await R.list(uid, "opp")).filter((o) => st === "all" || o.user_state === st);
      return ok({ opportunities: opps.sort((a, b) => (b.fit?.rank || 0) - (a.fit?.rank || 0)).map(summary) });
    }
    if ((m = p.match(/^\/opps\/([\w-]+)$/)) && method === "GET") { const o = await R.get(uid, "opp", m[1]); need(o, 404, "Not found"); return ok({ opportunity: o }); }
    if ((m = p.match(/^\/opps\/([\w-]+)\/state$/)) && method === "POST") {
      need(["new", "saved", "dismissed"].includes(body.state), 400, "Bad state");
      const o = await R.patch(uid, "opp", m[1], (o) => ({ ...o, user_state: body.state, dismissed_reason: body.state === "dismissed" ? clip(body.reason, 200) : "" }));
      need(o, 404, "Not found");
      const app = body.state === "saved" ? await ensureApp(uid, o) : null;
      return ok({ opportunity: summary(o), app });
    }
    if ((m = p.match(/^\/opps\/([\w-]+)\/check$/)) && method === "POST") {
      const [o, profile, claims] = await Promise.all([R.get(uid, "opp", m[1]), profileOf(uid), R.list(uid, "claim")]);
      need(o, 404, "Not found");
      const r = await ats.checkStatus(o, companiesFor(profile));
      const next = { ...o, ...(r.fresh || {}), user_state: o.user_state, first_seen: o.first_seen, notes: o.notes, status: r.status, status_evidence: r.status_evidence, last_checked: r.status_evidence.checked_at };
      next.fit = await fit.assess(next, profile, claims);
      return ok({ opportunity: await R.put(uid, "opp", next) });
    }
    if (p === "/opps/reassess" && method === "POST") {
      const [opps, profile, claims] = await Promise.all([R.list(uid, "opp"), profileOf(uid), R.list(uid, "claim")]);
      const fits = await fit.assessMany(opps, profile, claims);
      for (const [i, o] of opps.entries()) await R.put(uid, "opp", { ...o, fit: fits[i] });
      return ok({ reassessed: opps.length });
    }
    if (p === "/boards/test" && method === "POST") {
      need(ats.FEEDS[body.ats] && /^[\w.-]{1,80}$/.test(body.board || ""), 400, "Pick Greenhouse, Lever or Ashby and enter the board name from the jobs URL.");
      const b = await ats.fetchBoard({ name: body.board, ats: body.ats, board: body.board }, { fresh: true });
      return ok({ ok: !b.error, jobs: b.raw.length, error: b.error, sample: b.raw.slice(0, 3).map((j) => j.title) });
    }

    // ----- applications -----
    if (p === "/apps" && method === "GET") return ok({ apps: await appsWithBlockers(uid) });
    if (p === "/apps" && method === "POST") {
      if (body.opp_id) { const o = await R.get(uid, "opp", body.opp_id); need(o, 404, "Not found"); await R.patch(uid, "opp", o.id, (x) => ({ ...x, user_state: "saved" })); return ok({ app: await ensureApp(uid, o) }); }
      need(body.title && body.company, 400, "Title and company are required.");
      return ok({ app: await putApp(uid, { title: body.title, company: body.company, url: body.url, stage: body.stage }) });
    }
    if ((m = p.match(/^\/apps\/([\w-]+)$/)) && method === "PATCH") {
      const app = await R.get(uid, "app", m[1]);
      need(app, 404, "Not found");
      need(body.stage !== "submitted", 400, "Use the final review screen to mark an application submitted.");
      if (body.stage) setStage(app, body.stage, body.note);
      for (const k of ["next_action", "follow_up", "expected_schedule", "notes"]) if (k in body && body[k] !== app[k]) { app[k] = clip(body[k], k === "notes" ? 4000 : 300); log(app, k, `${k.replace("_", " ")}: ${clip(body[k], 120)}`); }
      if ("deadline" in body) { app.deadline = isDate(body.deadline) ? { date: body.deadline, source: "you", confidence: "high", firm: true } : null; log(app, "deadline", `deadline: ${body.deadline || "cleared"}`); }
      if (Array.isArray(body.contact_ids)) app.contact_ids = list(body.contact_ids, 30, 60);
      return ok({ app: await R.put(uid, "app", app) });
    }
    if ((m = p.match(/^\/apps\/([\w-]+)$/)) && method === "DELETE") { await R.remove(uid, "app", m[1]); return ok({ ok: true }); }
    if ((m = p.match(/^\/apps\/([\w-]+)\/draft$/)) && method === "POST") {
      const [app, profile, claims, library] = await Promise.all([R.get(uid, "app", m[1]), profileOf(uid), R.list(uid, "claim"), R.list(uid, "answer")]);
      need(app, 404, "Not found");
      const opp = app.opp_id ? await R.get(uid, "opp", app.opp_id) : { title: app.title, company: app.company, department: "", description: "", evidence: {} };
      let key, a;
      if (body.kind === "resume") { key = "resume"; a = await resumeFromClaims(profile, claims, opp); a.base = (await resumeFromClaims(profile, claims, null)).text; }
      else if (body.kind === "cover_letter") { key = "cover_letter"; a = await mat.coverLetter({ opp, profile, claims }); if (body.ai) a = await aiRewrite(user, "cover_letter", a, { opp, profile, claims }); }
      else if (body.kind === "question") {
        need(clip(body.question, 600).trim(), 400, "Paste the question first.");
        const qid = body.question_id || "q" + Date.now().toString(36);
        app.materials = app.materials || { questions: [] };
        if (!(app.materials.questions || []).some((q) => q.id === qid)) app.materials.questions = [...(app.materials.questions || []), { id: qid, question: clip(body.question, 600) }];
        key = "q:" + qid; a = await mat.answerDraft({ question: body.question, opp, profile, claims, library });
        if (body.ai && !a.reused) a = await aiRewrite(user, "question", a, { opp, profile, claims, question: body.question });
      } else throw new HttpError(400, "Unknown draft kind");
      a.written_by = a.written_by || null;
      setArtifact(app, key, a);
      if (["shortlisted", "researching", "discovered"].includes(app.stage)) setStage(app, "preparing", "Started materials");
      log(app, "draft", `Drafted ${key}`);
      return ok({ app: await R.put(uid, "app", app) });
    }
    if ((m = p.match(/^\/apps\/([\w-]+)\/artifact$/)) && method === "PUT") {
      const [app, profile, claims] = await Promise.all([R.get(uid, "app", m[1]), profileOf(uid), R.list(uid, "claim")]);
      need(app, 404, "Not found");
      const cur = getArtifact(app, body.key);
      need(cur, 404, "Draft not found");
      const text = clip(body.text, 20000);
      setArtifact(app, body.key, { text, claim_ids: cur.claim_ids || [], flags: mat.flagsFor(text, { claims, profile, usedClaimIds: cur.claim_ids || [] }) });
      log(app, "edit", `Edited ${body.key}`);
      return ok({ app: await R.put(uid, "app", app) });
    }
    if ((m = p.match(/^\/apps\/([\w-]+)\/artifact$/)) && method === "DELETE") {
      const app = await R.get(uid, "app", m[1]); need(app, 404, "Not found");
      if (String(body.key).startsWith("q:")) app.materials.questions = (app.materials.questions || []).filter((q) => "q:" + q.id !== body.key);
      else delete app.materials[body.key];
      return ok({ app: await R.put(uid, "app", app) });
    }
    if ((m = p.match(/^\/apps\/([\w-]+)\/approve$/)) && method === "POST") {
      const app = await R.get(uid, "app", m[1]); need(app, 404, "Not found");
      const a = getArtifact(app, body.key); need(a, 404, "Draft not found");
      const ack = list(body.acknowledge, 100, 200);
      const open = (a.flags || []).filter((f) => !ack.includes(f.id));
      need(!open.length, 409, `Resolve or acknowledge ${open.length} flag(s) first: ${open.map((f) => f.message).join(" ")}`);
      a.acknowledged = ack; a.approved_at = nowIso(); a.approved_text_hash = require("crypto").createHash("sha256").update(a.text || "").digest("hex").slice(0, 16);
      log(app, "approve", `Approved ${body.key}${ack.length ? ` (acknowledged ${ack.length} flag(s))` : ""}`);
      if (app.stage === "preparing" && !mat.unresolved(app).length) setStage(app, "ready_for_review", "All materials approved");
      return ok({ app: await R.put(uid, "app", app) });
    }
    if ((m = p.match(/^\/apps\/([\w-]+)\/packet$/)) && method === "GET") {
      const app = await R.get(uid, "app", m[1]); need(app, 404, "Not found");
      const opp = app.opp_id ? await R.get(uid, "opp", app.opp_id) : null;
      const pk = mat.packet(app, opp);
      return ok({ ...pk, unresolved: mat.unresolved(app), destination: opp?.apply_url || app.url || "", eligibility: opp?.fit?.eligibility || null, status: opp?.status || "not checked", last_checked: opp?.last_checked || null });
    }
    if ((m = p.match(/^\/apps\/([\w-]+)\/submit$/)) && method === "POST") {
      const app = await R.get(uid, "app", m[1]); need(app, 404, "Not found");
      const opp = app.opp_id ? await R.get(uid, "opp", app.opp_id) : null;
      const pk = mat.packet(app, opp);
      need(body.confirm === true, 400, "Final approval is required.");
      need(!mat.unresolved(app).length, 409, "The packet still has unresolved items.");
      need(body.hash === pk.hash, 409, "The packet changed since you reviewed it. Review it again.");
      app.submission = { packet_hash: pk.hash, destination: clip(body.destination || opp?.apply_url || app.url, 500), approved_at: nowIso(), submitted_by: "you, on the employer's site", receipt: clip(body.receipt, 1000), packet_text: pk.text };
      setStage(app, "submitted", "Final approval recorded; submitted by you");
      app.next_action = "Follow up in 1–2 weeks"; app.follow_up = addDays(today(), 10);
      return ok({ app: await R.put(uid, "app", app) });
    }
    if ((m = p.match(/^\/apps\/([\w-]+)\/save-answer$/)) && method === "POST") {
      const app = await R.get(uid, "app", m[1]); need(app, 404, "Not found");
      const q = (app.materials?.questions || []).find((x) => x.id === body.question_id); need(q?.approved_at, 409, "Approve the answer first.");
      return ok({ answer: await R.put(uid, "answer", { question: q.question, answer: q.answer || q.text, claim_ids: q.claim_ids || [], tags: list(body.tags, 10, 40), reconfirm: !!body.reconfirm, approved_at: nowIso(), from_app: app.id, context: `${app.title} @ ${app.company}` }) });
    }
    if (p === "/apps.csv" && method === "GET") {
      const apps = await R.list(uid, "app");
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = [["Company", "Role", "Stage", "Deadline", "Deadline source", "Next action", "Follow up", "URL", "Updated"], ...apps.map((a) => [a.company, a.title, a.stage, a.deadline?.date, a.deadline?.source, a.next_action, a.follow_up, a.url, a.updated_at])];
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="boot-outreach-applications.csv"', "Cache-Control": "no-store" });
      return res.end(rows.map((r) => r.map(cell).join(",")).join("\n")), true;
    }
    if (p === "/calendar.ics" && method === "GET") {
      // Only firm dates go on the calendar: your own deadlines, structured ATS deadlines, and follow-ups. Past dates are skipped.
      const [apps, outs, contacts] = await Promise.all([R.list(uid, "app"), R.list(uid, "outreach"), R.list(uid, "contact")]);
      const items = [];
      for (const a of apps) {
        if (["rejected", "withdrawn", "archived"].includes(a.stage)) continue;
        const events = [];
        if (a.deadline?.date && a.deadline.firm && a.deadline.date >= today()) events.push({ kind: "deadline", title: `Apply: ${a.title} @ ${a.company}`, date: a.deadline.date, url: a.url });
        if (isDate(a.follow_up) && a.follow_up >= today()) events.push({ kind: "event", title: `Follow up: ${a.title} @ ${a.company}`, date: a.follow_up, url: a.url });
        items.push({ id: a.id, status: "saved", opp: { title: a.title, org: a.company, url: a.url }, detail: { events } });
      }
      const cname = new Map(contacts.map((c) => [c.id, c.name]));
      for (const o of outs) if (isDate(o.follow_up) && o.follow_up >= today() && ["sent", "no_reply"].includes(o.status)) items.push({ id: o.id, status: "saved", opp: {}, detail: { events: [{ kind: "event", title: `Follow up with ${cname.get(o.contact_id) || "contact"}`, date: o.follow_up }] } });
      const { ics } = require("./ics");
      res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="boot-outreach.ics"', "Cache-Control": "no-store" });
      return res.end(ics(items, "Boot Outreach")), true;
    }

    // ----- contacts -----
    if (p === "/contacts" && method === "GET") return ok({ contacts: await R.list(uid, "contact") });
    if (p === "/contacts" && method === "POST") {
      const prev = body.id ? (await R.get(uid, "contact", body.id)) || {} : {};
      const c = {
        ...prev, id: prev.id || body.id, name: clip(body.name ?? prev.name, 120), company: clip(body.company ?? prev.company, 160), role: clip(body.role ?? prev.role, 160),
        relationship: clip(body.relationship ?? prev.relationship, 200), shared_context: clip(body.shared_context ?? prev.shared_context, 300), profile_url: clip(body.profile_url ?? prev.profile_url, 300),
        channel: ["email", "linkedin", "other"].includes(body.channel) ? body.channel : prev.channel || "email",
        email: clip(body.email ?? prev.email, 200), email_status: ["verified", "from_export", "user_provided", "inferred", "none"].includes(body.email_status) ? body.email_status : prev.email_status || (body.email ? "user_provided" : "none"),
        source: clip(body.source ?? prev.source ?? "manual", 40), source_url: clip(body.source_url ?? prev.source_url, 300),
        verification: ["verified", "unverified"].includes(body.verification) ? body.verification : prev.verification || "unverified",
        follow_up: isDate(body.follow_up) ? body.follow_up : prev.follow_up || "", notes: clip(body.notes ?? prev.notes, 2000), opt_out: body.opt_out ?? prev.opt_out ?? false,
        last_interaction: prev.last_interaction || null,
      };
      need(c.name, 400, "Name is required.");
      return ok({ contact: await R.put(uid, "contact", c) });
    }
    if ((m = p.match(/^\/contacts\/([\w-]+)$/)) && method === "DELETE") { await R.remove(uid, "contact", m[1]); return ok({ ok: true }); }
    if (p === "/contacts/import-linkedin" && method === "POST") {
      const rows = parseCSV(clip(body.csv, 5e6));
      const hi = rows.findIndex((r) => r.some((c) => /first name/i.test(c)) && r.some((c) => /last name/i.test(c)));
      need(hi >= 0, 400, "That doesn't look like LinkedIn's Connections.csv (no 'First Name' / 'Last Name' header).");
      const H = rows[hi].map((h) => h.trim().toLowerCase());
      const col = (r, name) => r[H.indexOf(name)]?.trim() || "";
      const existing = await R.list(uid, "contact");
      const byUrl = new Map(existing.filter((c) => c.profile_url).map((c) => [c.profile_url, c]));
      let added = 0, updated = 0;
      for (const r of rows.slice(hi + 1)) {
        const name = [col(r, "first name"), col(r, "last name")].filter(Boolean).join(" ");
        if (!name) continue;
        const url = col(r, "url"), email = col(r, "email address");
        const prev = byUrl.get(url);
        const c = { ...(prev || {}), name: clip(name, 120), company: clip(col(r, "company"), 160), role: clip(col(r, "position"), 160), profile_url: clip(url, 300), relationship: prev?.relationship || "1st-degree LinkedIn connection", connected_on: clip(col(r, "connected on"), 40), channel: prev?.channel || (email ? "email" : "linkedin"), email: clip(email || prev?.email, 200), email_status: email ? "from_export" : prev?.email_status || "none", source: "linkedin_export", source_url: url, verification: "verified", notes: prev?.notes || "", follow_up: prev?.follow_up || "", opt_out: prev?.opt_out || false };
        await R.put(uid, "contact", c);
        prev ? updated++ : added++;
      }
      return ok({ added, updated });
    }
    if (p === "/apollo/search" && method === "POST") return ok({ people: await apolloSearch(body) });

    // ----- outreach (drafts, approval, user-sent log) -----
    if (p === "/outreach" && method === "GET") return ok({ outreach: await R.list(uid, "outreach") });
    if (p === "/outreach/draft" && method === "POST") {
      const [contact, profile, claims] = await Promise.all([R.get(uid, "contact", body.contact_id), profileOf(uid), R.list(uid, "claim")]);
      need(contact, 404, "Contact not found");
      need(!contact.opt_out, 409, "This contact opted out.");
      const app = body.app_id ? await R.get(uid, "app", body.app_id) : null;
      const opp = app?.opp_id ? await R.get(uid, "opp", app.opp_id) : app ? { title: app.title, company: app.company, department: "" } : null;
      const channel = ["email", "linkedin"].includes(body.channel) ? body.channel : contact.channel === "linkedin" ? "linkedin" : "email";
      let d = await mat.outreachDraft({ contact, opp, profile, claims, channel });
      if (body.ai) d = await aiRewrite(user, "outreach", d, { opp, profile, claims, contact, channel });
      return ok({ outreach: await R.put(uid, "outreach", { contact_id: contact.id, app_id: app?.id || null, channel, text: d.text, claim_ids: d.claim_ids, flags: d.flags, written_by: d.written_by || null, status: "draft", history: [{ at: nowIso(), type: "draft" }] }) });
    }
    if ((m = p.match(/^\/outreach\/([\w-]+)$/)) && method === "PUT") {
      const [o, profile, claims] = await Promise.all([R.get(uid, "outreach", m[1]), profileOf(uid), R.list(uid, "claim")]);
      need(o, 404, "Not found"); need(!o.sent_at, 409, "Already sent; start a follow-up instead.");
      const text = clip(body.text, 5000);
      return ok({ outreach: await R.put(uid, "outreach", { ...o, text, flags: mat.flagsFor(text, { claims, profile, usedClaimIds: o.claim_ids || [] }), status: "draft", approved_at: null, approved_text: null, acknowledged: [], history: [...(o.history || []), { at: nowIso(), type: "edit" }] }) });
    }
    if ((m = p.match(/^\/outreach\/([\w-]+)\/approve$/)) && method === "POST") {
      const o = await R.get(uid, "outreach", m[1]); need(o, 404, "Not found");
      const ack = list(body.acknowledge, 100, 200);
      const open = (o.flags || []).filter((f) => !ack.includes(f.id));
      need(!open.length, 409, `Resolve or acknowledge ${open.length} flag(s) first: ${open.map((f) => f.message).join(" ")}`);
      return ok({ outreach: await R.put(uid, "outreach", { ...o, status: "approved", approved_text: o.text, approved_at: nowIso(), acknowledged: ack, history: [...(o.history || []), { at: nowIso(), type: "approve" }] }) });
    }
    if ((m = p.match(/^\/outreach\/([\w-]+)\/sent$/)) && method === "POST") {
      const o = await R.get(uid, "outreach", m[1]); need(o, 404, "Not found");
      need(o.status === "approved" && o.approved_text === o.text, 409, "Approve the exact text before logging it as sent.");
      const follow = isDate(body.follow_up) ? body.follow_up : addDays(today(), 7);
      await R.patch(uid, "contact", o.contact_id, (c) => ({ ...c, last_interaction: nowIso(), follow_up: follow }));
      return ok({ outreach: await R.put(uid, "outreach", { ...o, status: "sent", sent_at: nowIso(), sent_by: "you (outside the app)", follow_up: follow, history: [...(o.history || []), { at: nowIso(), type: "sent", channel: o.channel }] }) });
    }
    if ((m = p.match(/^\/outreach\/([\w-]+)\/status$/)) && method === "POST") {
      const o = await R.get(uid, "outreach", m[1]); need(o, 404, "Not found");
      need(OUT_STATUS.includes(body.status) && !["draft", "approved", "sent"].includes(body.status), 400, "Bad status");
      if (body.status === "opted_out") await R.patch(uid, "contact", o.contact_id, (c) => ({ ...c, opt_out: true }));
      return ok({ outreach: await R.put(uid, "outreach", { ...o, status: body.status, follow_up: isDate(body.follow_up) ? body.follow_up : o.follow_up, history: [...(o.history || []), { at: nowIso(), type: "status", to: body.status }] }) });
    }
    if ((m = p.match(/^\/outreach\/([\w-]+)$/)) && method === "DELETE") { await R.remove(uid, "outreach", m[1]); return ok({ ok: true }); }

    // ----- answer library -----
    if (p === "/answers" && method === "GET") return ok({ answers: await R.list(uid, "answer") });
    if (p === "/answers" && method === "POST") {
      const prev = body.id ? (await R.get(uid, "answer", body.id)) || {} : {};
      const changed = prev.answer !== body.answer;
      return ok({ answer: await R.put(uid, "answer", { ...prev, id: prev.id || body.id, question: clip(body.question ?? prev.question, 600), answer: clip(body.answer ?? prev.answer, 5000), tags: body.tags ? list(body.tags, 10, 40) : prev.tags || [], reconfirm: body.reconfirm ?? prev.reconfirm ?? false, claim_ids: prev.claim_ids || [], approved_at: body.approve ? nowIso() : changed ? null : prev.approved_at || null }) });
    }
    if ((m = p.match(/^\/answers\/([\w-]+)$/)) && method === "DELETE") { await R.remove(uid, "answer", m[1]); return ok({ ok: true }); }

    // ----- your data -----
    if (p === "/export" && method === "GET") {
      const out = { exported_at: nowIso(), workspace: await R.exportAll(uid), main_app: { profile: await store.profileGet(uid), resume: await store.resumeGet(uid), cart: await store.cartList(uid) } };
      res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="boot-outreach-export.json"', "Cache-Control": "no-store" });
      return res.end(JSON.stringify(out, null, 1)), true;
    }
    if (p === "/import" && method === "POST") {
      const ws = body.workspace || body;
      let n = 0;
      for (const k of R.KINDS) for (const rec of Array.isArray(ws[k]) ? ws[k].slice(0, 2000) : []) {
        if (k === "claim") await R.put(uid, k, sanitizeClaim(rec, (await R.get(uid, "claim", rec.id)) || {}));
        else if (k === "profile") { const prev = await profileOf(uid); await R.put(uid, k, { ...prev, ...rec, id: "me", preferences: sanitizePrefs({ ...prev.preferences, ...rec.preferences }), eligibility: prev.eligibility }); }
        else await R.put(uid, k, rec);
        n++;
      }
      return ok({ imported: n, note: "Eligibility facts are never imported; confirm them yourself in Profile." });
    }
    if (p === "/all" && method === "DELETE") {
      need(body.confirm === "DELETE", 400, 'Type DELETE to confirm.');
      await R.deleteAll(uid);
      return ok({ ok: true });
    }
    throw new HttpError(404, "Unknown workspace endpoint");
  };
};
