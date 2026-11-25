// Fit assessment. Interest and experience are judged by MEANING using a free local embedding model (lib/semantic.js);
// if that model can't load, a keyword method is used instead and every result says which method produced it.
// Three separate answers, never merged into one "you qualify" claim:
//   interest_fit    – does the role match what you said you want?
//   experience_fit  – which stated requirements do your confirmed claims support?
//   eligibility     – what the posting says about visas / work authorization, next to the facts YOU confirmed.
const FAMILIES = {
  product: { desc: "Product management: deciding what to build, user research, roadmaps, specs, working with engineering and design", label: "Product", terms: ["product manager", "product management", "product ops", "product operations", "product"] },
  gtm: { desc: "Go-to-market: growth, marketing, sales, business development, partnerships, bringing a product to customers", label: "Go-to-market", terms: ["go-to-market", "gtm", "growth", "marketing", "sales", "business development", "bizdev", "partnerships", "account"] },
  tpm: { desc: "Technical program management: coordinating engineering projects, timelines, cross-team execution", label: "Technical program management", terms: ["technical program", "program manager", "tpm", "program management"] },
  solutions: { desc: "Customer and partner solutions: deploying the product with customers, solutions engineering, forward-deployed work, customer success", label: "Customer & partner solutions", terms: ["solutions", "customer success", "forward deployed", "deployment", "customer engineer", "sales engineer", "partner", "implementation"] },
  ops: { desc: "Startup operations and strategy: business operations, strategy, chief of staff, special projects, commercial operations", label: "Startup operations & strategy", terms: ["operations", "bizops", "strategy", "chief of staff", "special projects", "commercial", "business operations"] },
  swe: { desc: "Software engineering: writing production code, backend, frontend, infrastructure", label: "Software engineering", terms: ["software", "engineer", "developer", "full stack", "backend", "frontend", "infrastructure"] },
  research: { desc: "Research: scientific or machine learning research, experiments, papers", label: "Research", terms: ["research", "scientist"] },
  data: { desc: "Data and analytics: analysis, metrics, dashboards, data science", label: "Data & analytics", terms: ["data", "analytics", "analyst"] },
  robotics: { desc: "Robotics and hardware: robots, autonomy, mechatronics, embedded systems, mechanical and electrical engineering", label: "Robotics & hardware", terms: ["robot", "mechatronics", "autonomy", "hardware", "embedded", "firmware", "mechanical", "electrical", "perception", "controls"] },
};
const ROBOTICS_WORDS = /\b(robot\w*|humanoid|autonom\w+|mechatronic\w*|manipulat\w+|lidar|perception|actuator|embodied)\b/i;
const STOP = new Set("a an and are as at be by for from has have in is it its of on or our that the their this to we will with you your who what when where how all any can may must should able ability strong experience experiences work working team teams years year plus etc including include such using use other new well within across into about more than also both".split(" "));

const words = (s) => (String(s || "").toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || []).map((w) => w.replace(/[.-]+$/, "")).filter((w) => !STOP.has(w));
const has = (hay, term) => new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(hay);

function interestFitKeyword(opp, prefs = {}) {
  const fams = (prefs.role_families || []).filter((f) => FAMILIES[f]);
  const title = opp.title.toLowerCase(), dept = (opp.department || "").toLowerCase();
  const reasons = [], missing = [];
  let score = 0;
  if (!fams.length) missing.push("Pick role families in Profile → Preferences to score interest fit.");
  const titleHit = fams.find((f) => FAMILIES[f].terms.some((t) => has(title, t)));
  const deptHit = fams.find((f) => FAMILIES[f].terms.some((t) => has(dept, t)));
  // A title that also names a family you didn't pick ("Hardware Engineer, Manufacturing Operations") is a weaker match.
  const other = titleHit && Object.keys(FAMILIES).filter((f) => !fams.includes(f) && f !== "data").find((f) => FAMILIES[f].terms.some((t) => has(title, t)));
  if (titleHit && other) { score += 35; reasons.push(`Title matches ${FAMILIES[titleHit].label}, but is also ${FAMILIES[other].label}`); }
  else if (titleHit) { score += 60; reasons.push(`Title matches ${FAMILIES[titleHit].label}`); }
  else if (deptHit) { score += 35; reasons.push(`Team (${opp.department}) matches ${FAMILIES[deptHit].label}`); }
  if (/\b(mba|ph\.?d|doctoral|master'?s|graduate student)\b/i.test(opp.title) && !/\b(bs|ba|b\.s|undergrad\w*|bachelor'?s)\b/i.test(opp.title)) { score -= 40; reasons.push("Aimed at MBA / PhD / master's students"); }
  const inds = prefs.industries || [];
  const isRobotics = (opp.company_tags || []).includes("robotics") || ROBOTICS_WORDS.test(opp.title + " " + opp.description.slice(0, 4000));
  const isAI = (opp.company_tags || []).includes("ai");
  if (inds.includes("robotics") && isRobotics) { score += 20; reasons.push("Robotics company or role"); }
  else if (inds.includes("ai") && isAI) { score += 15; reasons.push("AI company"); }
  if ((prefs.locations || []).length) { score += 10; reasons.push(`In your locations (${opp.location || "see posting"})`); }
  const term = opp.evidence?.term?.value;
  if (prefs.term && term) {
    if (term.toLowerCase() === String(prefs.term).toLowerCase()) { score += 10; reasons.push(`Term matches (${term})`); }
    else { score -= 15; reasons.push(`Posting says ${term}; you want ${prefs.term}`); }
  } else if (prefs.term) missing.push("Posting doesn't state the term.");
  if ((prefs.company_stages || []).length && prefs.company_stages.includes(opp.company_stage)) { score += 5; reasons.push(`Company stage: ${opp.company_stage}`); }
  return { score: Math.max(0, Math.min(100, score)), reasons, missing, robotics: isRobotics };
}

// Claims that may be used to support anything: confirmed, or approximate (flagged wherever it's used).
const usable = (c) => c && (c.status === "verified" || c.status === "approximate");
function claimText(c) { return [c.preferred_wording || c.text, c.title, c.org, (c.skills || []).join(" "), (c.tags || []).join(" ")].join(" "); }

function supportFor(text, claims) {
  const req = new Set(words(text));
  const out = [];
  for (const c of claims.filter(usable)) {
    const cw = new Set(words(claimText(c)));
    const skillHit = (c.skills || []).some((s) => s && has(text.toLowerCase(), s.toLowerCase()));
    const overlap = [...req].filter((w) => cw.has(w));
    if (skillHit || overlap.length >= 2) out.push({ id: c.id, overlap: overlap.slice(0, 6), skill: skillHit });
  }
  return out.sort((a, b) => b.overlap.length + (b.skill ? 3 : 0) - (a.overlap.length + (a.skill ? 3 : 0))).slice(0, 3);
}

function experienceFitKeyword(opp, claims = []) {
  const reqs = opp.evidence?.required_qualifications?.value || [];
  const flags = [];
  for (const r of reqs) {
    const y = r.match(/(\d+)\+?\s*(?:years|yrs)/i);
    if (y && +y[1] >= 2) flags.push(`Asks for ${y[1]}+ years: "${r.slice(0, 120)}"`);
    if (/\bph\.?d\b/i.test(r) && !/(pursuing|or|preferred)/i.test(r)) flags.push(`Mentions a PhD: "${r.slice(0, 120)}"`);
  }
  if (!reqs.length) return { score: null, matched: [], unmatched: [], flags, missing: ["Posting has no requirements list we could read; open the posting."] };
  if (!claims.some(usable)) return { score: null, matched: [], unmatched: reqs, flags, missing: ["Confirm some claims in Profile → Claims to score experience fit."] };
  const matched = [], unmatched = [];
  for (const r of reqs) { const s = supportFor(r, claims); (s.length ? matched : unmatched).push(s.length ? { requirement: r, claims: s.map((x) => x.id) } : r); }
  return { score: Math.round((matched.length / reqs.length) * 100), matched, unmatched, flags, missing: [] };
}

function eligibility(opp, elig = {}) {
  const e = opp.evidence || {};
  const confirmed = Object.values(elig).some((f) => f && f.value && f.confirmed_on);
  const quotes = ["sponsorship", "work_authorization", "cpt_opt"].map((k) => e[k]).filter((x) => x && x.quote).map((x) => ({ quote: x.quote, source_url: x.source_url, checked_at: x.checked_at }));
  const uniq = quotes.filter((q, i) => quotes.findIndex((x) => x.quote === q.quote) === i);
  const citizen = String(elig.citizenship?.value || "").toLowerCase();
  const usPerson = /\b(u\.?s\.?|united states|american)\b/.test(citizen) || /permanent resident|green card/.test(String(elig.work_authorization?.value || "").toLowerCase());
  let state = "not_stated", label = "Not stated", note = "The posting doesn't say anything about visas or work authorization. Unknown: ask the recruiter.";
  if (/citizenship|u\.s\.-person|clearance/.test(e.work_authorization?.value || "")) {
    state = usPerson ? "requirement_noted" : "possible_conflict";
    label = usPerson ? "Requirement noted" : "Possible conflict";
    note = usPerson ? "The posting has a citizenship / U.S.-person requirement. Compare it with your confirmed status." : "The posting has a citizenship / U.S.-person / clearance requirement. Your confirmed facts don't show you meet it. Confirm with the employer before investing time.";
  } else if (/not offered/.test(e.sponsorship?.value || "")) {
    state = "check"; label = "Check with employer";
    note = "The posting says it doesn't sponsor visas. Whether that affects your situation for this role (for example, an internship on CPT) is a question for the employer and your school's DSO, not something this app decides.";
  } else if (/offered/.test(e.sponsorship?.value || "") || e.cpt_opt?.quote) {
    state = "posting_mentions_support"; label = "Posting mentions support";
    note = "The posting mentions visa sponsorship or CPT/OPT. Read the exact words and confirm they cover your case.";
  } else if (e.work_authorization?.quote) {
    state = "asks_authorization"; label = "Asks for authorization";
    note = "The posting asks for work authorization but doesn't say whether it sponsors. Unknown: ask the recruiter.";
  }
  if (!confirmed) note += " You haven't confirmed your own work-authorization facts yet (Profile → Eligibility).";
  return { state, label, note, quotes: uniq, profile_confirmed: confirmed, disclaimer: "Not legal advice. This compares the posting's words with facts you confirmed." };
}

// Ranking: interest and experience, plus the user's priority weights (0–3 each).
function rank(opp, fit, prefs = {}) {
  const p = prefs.priorities || {};
  const w = (k) => Math.max(0, Math.min(3, +p[k] || 0));
  let s = fit.interest.score * 0.6 + (fit.experience.score ?? 40) * 0.3;
  if (opp.company_stage === "startup") s += 4 * w("startup");
  const PG = ["product", "gtm", "solutions", "ops", "tpm"];
  const pg = fit.interest.close_families ? fit.interest.close_families.some((f) => PG.includes(f)) : PG.some((f) => FAMILIES[f].terms.some((t) => has(opp.title.toLowerCase(), t)));
  if (pg) s += 4 * w("product_gtm");
  if (fit.interest.robotics) s += 4 * w("robotics");
  if (opp.company_stage === "large" || opp.company_stage === "growth") s += 3 * w("brand");
  if (opp.evidence?.compensation?.value) s += 3 * w("compensation");
  if ((prefs.locations || []).length) s += 2 * w("location");
  if (fit.eligibility.state === "possible_conflict") s -= 25;
  return Math.max(0, Math.round(s));
}

// ---------- meaning-based (semantic) assessment ----------
const sem = require("./semantic");
// Fields used only for contrast: a role closer in meaning to one of these (or to a family you didn't pick) ranks lower.
const CONTRAST = {
  design: { label: "Design", desc: "Product and UX design: visual design, interaction design, prototyping in Figma, industrial design" },
  finance: { label: "Finance & accounting", desc: "Finance and accounting: revenue accounting, investing, financial analysis, tax" },
  legal: { label: "Legal & compliance", desc: "Legal, policy, regulatory and compliance work" },
  people: { label: "Recruiting & HR", desc: "Recruiting and HR: sourcing and interviewing candidates, talent acquisition, employee relations, payroll and benefits" },
  security: { label: "Security & IT", desc: "Security engineering, IT, and information security" },
};
const INDUSTRY_DESC = { ai: "An AI company building machine learning models or AI products", robotics: "A robotics company building robots, autonomy or physical hardware" };
const MIN_SUPPORT = 0.42; // cosine similarity at which a claim is treated as supporting a requirement

function intentParts(prefs = {}, query = "") {
  const parts = [];
  if (prefs.learning_goals) parts.push({ label: "your goal", text: prefs.learning_goals });
  if (query) parts.push({ label: "your search", text: query });
  for (const f of prefs.role_families || []) if (FAMILIES[f]) parts.push({ key: f, label: FAMILIES[f].label, text: FAMILIES[f].desc });
  return parts;
}
// Interest is judged on the role's title and team: short, specific text this model separates well.
const oppText = (o) => `${String(o.title).replace(/\[[^\]]*\]|\([^)]*20\d\d[^)]*\)/g, "").trim()}${o.department ? " — " + o.department : ""}`;
const reqClaimText = (c) => [c.preferred_wording || c.text, c.title, c.org, (c.skills || []).join(", ")].filter(Boolean).join(". ");

function hardRules(opp, prefs, score, reasons, missing) {
  if (/\b(mba|ph\.?d|doctoral|master'?s|graduate student)\b/i.test(opp.title)) { score -= 40; reasons.push("Aimed at MBA / PhD / master's students"); }
  const term = opp.evidence?.term?.value;
  if (prefs.term && term) {
    if (term.toLowerCase() === String(prefs.term).toLowerCase()) { score += 5; reasons.push(`Term matches (${term})`); }
    else { score -= 15; reasons.push(`Posting says ${term}; you want ${prefs.term}`); }
  } else if (prefs.term) missing.push("Posting doesn't state the term.");
  if ((prefs.company_stages || []).length && prefs.company_stages.includes(opp.company_stage)) { score += 5; reasons.push(`Company stage: ${opp.company_stage}`); }
  return Math.max(0, Math.min(100, score));
}

async function semanticMany(opps, profile, claims, query) {
  const prefs = profile.preferences || {};
  const parts = intentParts(prefs, query);
  const picked = new Set(prefs.role_families || []);
  const contrast = [...Object.entries(FAMILIES).filter(([k]) => !picked.has(k)), ...Object.entries(CONTRAST)].map(([k, v]) => ({ key: k, label: v.label, text: v.desc }));
  const xv = parts.length ? await sem.embed(contrast.map((c) => c.text)) : [];
  const inds = (prefs.industries || []).filter((i) => INDUSTRY_DESC[i]);
  const usableClaims = claims.filter(usable);
  const reqs = opps.map((o) => o.evidence?.required_qualifications?.value || []);
  const flatReqs = [...new Set(reqs.flat())];
  const [pv, iv, ov, rv, cv] = await Promise.all([
    sem.embed(parts.map((p) => p.text)), sem.embed(inds.map((i) => INDUSTRY_DESC[i])), sem.embed(opps.map(oppText)),
    sem.embed(flatReqs), sem.embed(usableClaims.map(reqClaimText)),
  ]);
  const reqVec = new Map(flatReqs.map((r, i) => [r, rv[i]]));
  const companyVecs = await sem.embed(opps.map((o) => `${o.company}. ${String(o.description || "").slice(0, 400)}`));
  return opps.map((o, k) => {
    // Interest: how close the role's meaning is to your goal, your search and the role families you picked.
    const reasons = [], missing = [];
    let score = 0;
    if (!parts.length) missing.push("Add your goal or pick role families in Profile to score interest by meaning.");
    else {
      const sims = parts.map((p, i) => ({ p, s: sem.cos(ov[k], pv[i]) })).sort((a, b) => b.s - a.s);
      // Role families are the specific signal; goal and search text are broad, so they count for less.
      const fam = sims.filter((x) => x.p.key), broad = sims.filter((x) => !x.p.key);
      const famBest = fam[0]?.s ?? null, broadBest = broad[0]?.s ?? null;
      const raw = famBest != null && broadBest != null ? 0.65 * famBest + 0.35 * broadBest : famBest ?? broadBest;
      score = sem.toScore(raw, 0.2, 0.5);
      if (fam[0]) reasons.push(`Closest role family: ${fam[0].p.label} (${fam[0].s.toFixed(2)})`);
      if (broad[0]) reasons.push(`${broad[0].p.label} (${broad[0].s.toFixed(2)})`);
      // Contrast: if the role is clearly closer to a field you didn't pick, say so and rank it lower.
      const ref = famBest ?? broadBest;
      const other = contrast.map((c, i) => ({ c, s: sem.cos(ov[k], xv[i]) })).sort((a, b) => b.s - a.s)[0];
      if (other && other.s > ref + 0.03) {
        const pen = Math.min(45, Math.round((other.s - ref) * 400));
        score -= pen;
        reasons.push(`but closer to ${other.c.label} (${other.s.toFixed(2)}), which you didn't pick`);
      }
    }
    let robotics = false;
    inds.forEach((ind, i) => {
      const s = sem.cos(companyVecs[k], iv[i]);
      const tagged = (o.company_tags || []).includes(ind);
      if (tagged || s > 0.4) { score += ind === "robotics" ? 12 : 8; reasons.push(ind === "robotics" ? "Robotics company or role" : "AI company"); if (ind === "robotics") robotics = true; }
    });
    score = hardRules(o, prefs, score, reasons, missing);
    const close_families = parts.map((p, i) => ({ k: p.key, s: sem.cos(ov[k], pv[i]) })).filter((x) => x.k && x.s >= 0.38).map((x) => x.k);
    const interest = { score, reasons, missing, robotics, close_families, method: "meaning" };

    // Experience: for each stated requirement, the confirmed claims closest in meaning.
    const kw = experienceFitKeyword(o, claims); // reuse its flags (years, PhD)
    let experience;
    if (!reqs[k].length) experience = { ...kw, method: "meaning" };
    else if (!usableClaims.length) experience = { ...kw, method: "meaning" };
    else {
      const matched = [], unmatched = [];
      for (const r of reqs[k]) {
        const best = usableClaims.map((c, j) => ({ id: c.id, s: sem.cos(reqVec.get(r), cv[j]) })).filter((x) => x.s >= MIN_SUPPORT).sort((a, b) => b.s - a.s).slice(0, 2);
        best.length ? matched.push({ requirement: r, claims: best.map((b) => b.id), similarity: +best[0].s.toFixed(2) }) : unmatched.push(r);
      }
      experience = { score: Math.round((matched.length / reqs[k].length) * 100), matched, unmatched, flags: kw.flags, missing: [], method: "meaning" };
    }
    return { interest, experience };
  });
}

// Assess many opportunities at once (one batch of embeddings). Falls back to keywords if the model is unavailable.
async function assessMany(opps, profile = {}, claims = [], { query = "" } = {}) {
  const prefs = profile.preferences || {};
  let parts;
  try { parts = await semanticMany(opps, profile, claims, query); }
  catch (e) {
    console.error(e.message);
    parts = opps.map((o) => ({ interest: { ...interestFitKeyword(o, prefs), method: "keyword fallback (meaning model unavailable)" }, experience: { ...experienceFitKeyword(o, claims), method: "keyword fallback" } }));
  }
  return opps.map((o, i) => {
    const fit = { ...parts[i], eligibility: eligibility(o, profile.eligibility || {}) };
    return { ...fit, rank: rank(o, fit, prefs), assessed_at: new Date().toISOString(), profile_version: profile.updated_at || null };
  });
}
const assess = async (opp, profile, claims, opts) => (await assessMany([opp], profile, claims, opts))[0];

// Claims that best support a piece of text (requirement, question, role), by meaning; keyword fallback.
async function support(text, claims, limit = 3) {
  const use = claims.filter(usable);
  if (!use.length || !String(text || "").trim()) return [];
  try {
    const [[tv], cv] = await Promise.all([sem.embed([text]), sem.embed(use.map(reqClaimText))]);
    return use.map((c, i) => ({ id: c.id, s: sem.cos(tv, cv[i]) })).filter((x) => x.s >= MIN_SUPPORT - 0.04).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => ({ id: x.id, similarity: +x.s.toFixed(2) }));
  } catch { return supportFor(text, claims).slice(0, limit); }
}

// "NYC or Bay Area AI/robotics internships for Summer 2027, product or GTM" → structured filters.
function parseQuery(q = "") {
  const s = String(q).toLowerCase();
  const locations = [];
  if (/\b(nyc|new york)\b/.test(s)) locations.push("NYC");
  if (/\b(bay area|sf|san francisco|silicon valley|palo alto)\b/.test(s)) locations.push("Bay Area");
  for (const city of ["seattle", "boston", "austin", "los angeles", "chicago", "london", "singapore"]) if (s.includes(city)) locations.push(city.replace(/\b\w/g, (c) => c.toUpperCase()));
  const role_families = Object.entries(FAMILIES).filter(([k, f]) => f.terms.some((t) => has(s, t)) || has(s, k)).map(([k]) => k);
  const industries = [/\b(ai|artificial intelligence|ml|machine learning)\b/.test(s) && "ai", /\brobot/.test(s) && "robotics"].filter(Boolean);
  const tm = s.match(/\b(summer|fall|spring|winter)\s*(20\d\d)\b/);
  const level = /\b(intern|internship|co-?op)\b/.test(s) ? "internship" : /\b(new grad|full[- ]time|early career)\b/.test(s) ? "early" : "internship";
  return { locations, include_remote: /\bremote\b/.test(s) || !locations.length, role_families, industries, term: tm ? `${tm[1][0].toUpperCase()}${tm[1].slice(1)} ${tm[2]}` : "", level };
}

module.exports = { FAMILIES, assess, assessMany, support, parseQuery, supportFor, words, usable };
