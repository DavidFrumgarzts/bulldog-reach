// Deterministic fit assessment (no model calls, so it's free and reproducible).
// Three separate answers, never merged into one "you qualify" claim:
//   interest_fit    – does the role match what you said you want?
//   experience_fit  – which stated requirements do your confirmed claims support?
//   eligibility     – what the posting says about visas / work authorization, next to the facts YOU confirmed.
const FAMILIES = {
  product: { label: "Product", terms: ["product manager", "product management", "product ops", "product operations", "product"] },
  gtm: { label: "Go-to-market", terms: ["go-to-market", "gtm", "growth", "marketing", "sales", "business development", "bizdev", "partnerships", "account"] },
  tpm: { label: "Technical program management", terms: ["technical program", "program manager", "tpm", "program management"] },
  solutions: { label: "Customer & partner solutions", terms: ["solutions", "customer success", "forward deployed", "deployment", "customer engineer", "sales engineer", "partner", "implementation"] },
  ops: { label: "Startup operations & strategy", terms: ["operations", "bizops", "strategy", "chief of staff", "special projects", "commercial", "business operations"] },
  swe: { label: "Software engineering", terms: ["software", "engineer", "developer", "full stack", "backend", "frontend", "infrastructure"] },
  research: { label: "Research", terms: ["research", "scientist"] },
  data: { label: "Data & analytics", terms: ["data", "analytics", "analyst"] },
  robotics: { label: "Robotics & hardware", terms: ["robot", "mechatronics", "autonomy", "hardware", "embedded", "firmware", "mechanical", "electrical", "perception", "controls"] },
};
const ROBOTICS_WORDS = /\b(robot\w*|humanoid|autonom\w+|mechatronic\w*|manipulat\w+|lidar|perception|actuator|embodied)\b/i;
const STOP = new Set("a an and are as at be by for from has have in is it its of on or our that the their this to we will with you your who what when where how all any can may must should able ability strong experience experiences work working team teams years year plus etc including include such using use other new well within across into about more than also both".split(" "));

const words = (s) => (String(s || "").toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || []).map((w) => w.replace(/[.-]+$/, "")).filter((w) => !STOP.has(w));
const has = (hay, term) => new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(hay);

function interestFit(opp, prefs = {}) {
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
  if (/\b(mba|ph\.?d|doctoral|master'?s|graduate student)\b/i.test(opp.title)) { score -= 40; reasons.push("Aimed at MBA / PhD / master's students"); }
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

function experienceFit(opp, claims = []) {
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
  if (["product", "gtm", "solutions", "ops", "tpm"].some((f) => FAMILIES[f].terms.some((t) => has(opp.title.toLowerCase(), t)))) s += 4 * w("product_gtm");
  if (fit.interest.robotics) s += 4 * w("robotics");
  if (opp.company_stage === "large" || opp.company_stage === "growth") s += 3 * w("brand");
  if (opp.evidence?.compensation?.value) s += 3 * w("compensation");
  if ((prefs.locations || []).length) s += 2 * w("location");
  if (fit.eligibility.state === "possible_conflict") s -= 25;
  return Math.round(s);
}

function assess(opp, profile = {}, claims = []) {
  const prefs = profile.preferences || {};
  const fit = { interest: interestFit(opp, prefs), experience: experienceFit(opp, claims), eligibility: eligibility(opp, profile.eligibility || {}) };
  return { ...fit, rank: rank(opp, fit, prefs), assessed_at: new Date().toISOString(), profile_version: profile.updated_at || null };
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

module.exports = { FAMILIES, assess, parseQuery, supportFor, words, usable };
