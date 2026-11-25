// Public ATS job-board feeds → normalized opportunities with field-level evidence.
// Greenhouse:  https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true
// Lever:       https://api.lever.co/v0/postings/{board}?mode=json
// Ashby:       https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
// All three are free, keyless, official employer feeds. We cache each board for 30 minutes and fetch a few at a time.
const crypto = require("crypto");

const FEEDS = {
  greenhouse: (b) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b)}/jobs?content=true`,
  lever: (b) => `https://api.lever.co/v0/postings/${encodeURIComponent(b)}?mode=json`,
  ashby: (b) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b)}?includeCompensation=true`,
};
const TTL = 30 * 60e3;
const cache = new Map(); // `${ats}:${board}` → { at, jobs, error }

// ---------- text helpers ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…", bull: "•" };
const decode = (s) => String(s || "").replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
function htmlToText(html) {
  let s = decode(html); // Greenhouse double-escapes its HTML
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n• ").replace(/<\/(p|div|h[1-6]|li|ul|ol|tr)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h[1-6][^>]*>/gi, "\n").replace(/<[^>]+>/g, "");
  return decode(s).replace(/[ \t ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}
const sentences = (text) => String(text || "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.replace(/^•\s*/, "").trim()).filter((x) => x.length > 3);
const clip = (s, n) => String(s || "").slice(0, n);
const quoteOf = (s) => clip(s.replace(/\s+/g, " ").trim(), 320);

// ---------- evidence extraction ----------
// Every field is either { value, quote, source_url, checked_at, method, confidence } or { value: null, status: "not stated" }.
function ev(value, quote, method, confidence, ctx) { return { value, quote: quote ? quoteOf(quote) : "", source_url: ctx.url, checked_at: ctx.at, method, confidence }; }
const notStated = () => ({ value: null, status: "not stated" });
function firstSentence(text, re) { return sentences(text).find((s) => re.test(s)) || ""; }

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
function parseDate(s) {
  const iso = s.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = s.match(new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`, "i"));
  if (m) { const d = new Date(`${m[1].slice(0, 3)} ${m[2]} ${m[3]} 12:00 UTC`); if (!isNaN(d)) return d.toISOString().slice(0, 10); }
  const us = s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

function extractEvidence(job, text, ctx) {
  const e = {};
  // Deadline: structured field first, then explicit wording with a parseable date.
  if (job._deadline) e.deadline = ev(String(job._deadline).slice(0, 10), "", "ats_field", "high", ctx);
  else {
    const s = firstSentence(text, /(apply by|application deadline|applications? (?:close|due|will close)|deadline to apply|submit .* by)/i);
    const d = s && parseDate(s);
    e.deadline = d ? ev(d, s, "text_pattern", "medium", ctx) : s ? { ...ev(null, s, "text_pattern", "low", ctx), status: "mentioned, no exact date" } : notStated();
  }
  // Compensation
  if (job._comp) e.compensation = ev(job._comp, "", "ats_field", "high", ctx);
  else {
    const s = firstSentence(text, /\$\s?\d[\d,.]*\s?(k|K)?(\s?(-|–|—|to)\s?\$?\s?\d[\d,.]*\s?(k|K)?)?(\s?(per|\/)\s?(hour|hr|year|yr|month|annum))?/);
    const amt = s && s.match(/\$\s?\d[\d,.]*\s?[kK]?(\s?(-|–|—|to)\s?\$?\s?\d[\d,.]*\s?[kK]?)?(\s?(per|\/)\s?(hour|hr|year|yr|month|annum))?/);
    e.compensation = amt ? ev(amt[0].trim(), s, "text_pattern", "medium", ctx) : notStated();
  }
  // Work mode
  if (job._mode) e.work_mode = ev(job._mode, "", "ats_field", "high", ctx);
  else {
    const s = firstSentence(text, /\b(remote|hybrid|on-?site|in[- ]office|in person)\b/i);
    const v = s && (/hybrid/i.test(s) ? "hybrid" : /remote/i.test(s) ? "remote" : "onsite");
    e.work_mode = v ? ev(v, s, "text_pattern", "low", ctx) : notStated();
  }
  // Term (season + year)
  const termSrc = `${job._title}\n${text}`;
  const tm = termSrc.match(/\b(summer|fall|autumn|spring|winter)\s*(?:'|20)?(\d{2})\b/i);
  e.term = tm ? ev(`${tm[1][0].toUpperCase()}${tm[1].slice(1).toLowerCase()} 20${tm[2]}`, firstSentence(termSrc, new RegExp(tm[0].replace(/'/g, "'?"), "i")) || tm[0], "text_pattern", "medium", ctx) : notStated();
  // Visa sponsorship — quote the employer; classify only what the words say.
  const sp = firstSentence(text, /\b(sponsor\w*|visa|h-?1b)\b/i);
  if (!sp) e.sponsorship = notStated();
  else {
    const no = /(not|unable to|cannot|can't|won't|will not|do not|does not|no)\b[^.]{0,40}\bsponsor|without (the need for )?(current or future )?(visa )?sponsorship|sponsorship (is )?not (available|offered|provided)/i.test(sp);
    const yes = !no && /(will|can|able to|happy to|open to|do|does|we)\s+(provide\s+|offer\s+)?(visa\s+)?sponsor|sponsorship (is )?(available|offered|provided)|offer (visa )?sponsorship/i.test(sp);
    e.sponsorship = ev(no ? "posting says not offered" : yes ? "posting says offered" : "mentioned (read quote)", sp, "text_pattern", no || yes ? "medium" : "low", ctx);
  }
  // Work authorization / export control / citizenship
  const wa = firstSentence(text, /\b(authori[sz]ed to work|work authori[sz]ation|right to work|eligible to work|u\.?s\.? persons?|export control\w*|itar|security clearance|citizenship|u\.?s\.? citizens?|permanent residents?)\b/i);
  if (!wa) e.work_authorization = notStated();
  else {
    const restrict = /\b(u\.?s\.? persons?|itar|export control|security clearance|u\.?s\.? citizen|citizenship (is )?required|must be a (u\.?s\.? )?citizen)/i.test(wa);
    e.work_authorization = ev(restrict ? "posting has a citizenship / U.S.-person / clearance requirement" : "posting asks for work authorization (read quote)", wa, "text_pattern", "medium", ctx);
  }
  const cpt = firstSentence(text, /\b(CPT|OPT|curricular practical training|optional practical training|F-?1)\b/);
  e.cpt_opt = cpt ? ev("mentioned (read quote)", cpt, "text_pattern", "medium", ctx) : notStated();
  // Language requirement
  const lang = firstSentence(text, /(fluen\w+|proficien\w+|native|bilingual)[^.]{0,40}\b(english|mandarin|chinese|japanese|korean|spanish|french|german|portuguese|arabic|hindi|malay|tamil)\b/i);
  e.language = lang ? ev("stated (read quote)", lang, "text_pattern", "medium", ctx) : notStated();
  // Required qualifications: lines under a requirements-style heading.
  e.required_qualifications = requirements(text, ctx);
  return e;
}

const REQ_HEAD = /^(minimum |basic |required |preferred )?(qualifications|requirements|what you('|’)ll (need|bring)|you (have|might be a good fit|may be a good fit)|you should have|about you|who you are|what we('|’)re looking for|you('|’)ll thrive|ideal candidate|must[- ]haves?|skills)/i;
function requirements(text, ctx) {
  const lines = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length && out.length < 14; i++) {
    if (!REQ_HEAD.test(lines[i].replace(/^•\s*/, "")) || lines[i].length > 90) continue;
    for (let j = i + 1; j < lines.length && out.length < 14; j++) {
      const l = lines[j];
      if (!l.startsWith("•")) { if (out.length) break; continue; }
      out.push(clip(l.replace(/^•\s*/, ""), 300));
    }
  }
  return out.length ? { value: out, source_url: ctx.url, checked_at: ctx.at, method: "section_parse", confidence: "medium" } : notStated();
}

// ---------- normalizers ----------
const canon = (u) => { try { const x = new URL(u); x.hash = ""; x.search = ""; return x.toString().replace(/\/$/, ""); } catch { return String(u || ""); } };
const oppId = (url) => "o_" + crypto.createHash("sha1").update(canon(url)).digest("hex").slice(0, 16);

function normGreenhouse(j, co) {
  const meta = Object.fromEntries((j.metadata || []).map((m) => [String(m.name || "").toLowerCase(), m.value]));
  const mode = meta["location type"] || meta["workplace type"] || meta["remote"] || null;
  return {
    ats: "greenhouse", job_id: String(j.id), title: j.title, company: j.company_name || co.name,
    location: j.location?.name || "", locations: [j.location?.name, ...(j.offices || []).map((o) => o.name)].filter(Boolean),
    department: (j.departments || []).map((d) => d.name).join(" / "), type: meta["employment type"] || "",
    url: j.absolute_url, apply_url: j.absolute_url, published_at: j.first_published || j.updated_at || null,
    html: j.content || "", _deadline: j.application_deadline || null, _comp: null, _mode: Array.isArray(mode) ? mode.join(", ") : mode,
  };
}
function normLever(j, co) {
  const sr = j.salaryRange;
  const comp = sr && sr.min ? `${sr.currency || ""} ${sr.min.toLocaleString()}–${(sr.max || sr.min).toLocaleString()} ${sr.interval || ""}`.trim() : null;
  return {
    ats: "lever", job_id: j.id, title: j.text, company: co.name,
    location: j.categories?.location || "", locations: [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean),
    department: [j.categories?.department, j.categories?.team].filter(Boolean).join(" / "), type: j.categories?.commitment || "",
    url: j.hostedUrl, apply_url: j.applyUrl || j.hostedUrl, published_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    html: [j.description, ...(j.lists || []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`), j.additional].join("\n"),
    _deadline: null, _comp: comp, _mode: j.workplaceType && j.workplaceType !== "unspecified" ? j.workplaceType : null,
  };
}
function normAshby(j, co) {
  return {
    ats: "ashby", job_id: j.id, title: j.title, company: co.name,
    location: j.location || "", locations: [j.location, ...(j.secondaryLocations || []).map((l) => l.location)].filter(Boolean),
    department: [j.department, j.team].filter((x, i, a) => x && a.indexOf(x) === i).join(" / "), type: j.employmentType || "",
    url: j.jobUrl, apply_url: j.applyUrl || j.jobUrl, published_at: j.publishedAt || null,
    html: j.descriptionHtml || "", _deadline: null,
    _comp: j.shouldDisplayCompensationOnJobPostings ? j.compensation?.compensationTierSummary || null : null,
    _mode: j.workplaceType || (j.isRemote ? "Remote" : null), _listed: j.isListed !== false,
  };
}
const NORM = { greenhouse: normGreenhouse, lever: normLever, ashby: normAshby };

function toOpportunity(n, co, at) {
  const text = clip(htmlToText(n.html), 40000);
  const ctx = { url: n.url, at };
  return {
    id: oppId(n.url), canonical_url: canon(n.url), apply_url: n.apply_url,
    source: { ats: n.ats, board: co.board, job_id: n.job_id, feed: FEEDS[n.ats](co.board).replace(/\?.*$/, "") },
    company: n.company || co.name, company_stage: co.stage || "", company_tags: co.tags || [],
    title: clip(n.title, 200), location: clip(n.location, 200), locations: [...new Set(n.locations)].slice(0, 12),
    department: clip(n.department, 200), employment_type: clip(n.type, 60), published_at: n.published_at,
    description: text, evidence: extractEvidence({ ...n, _title: n.title }, text, ctx),
    status: "open", status_evidence: { method: "listed_in_feed", checked_at: at, source_url: FEEDS[n.ats](co.board).replace(/\?.*$/, "") },
    last_checked: at,
  };
}

// ---------- fetching ----------
async function fetchBoard(co, { fresh = false } = {}) {
  const key = `${co.ats}:${co.board}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit;
  const at = new Date().toISOString();
  try {
    const r = await fetch(FEEDS[co.ats](co.board), { headers: { "User-Agent": "BootOutreach/1.0 (job-search assistant; respects public ATS feeds)" }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const raw = co.ats === "lever" ? d : d.jobs || [];
    const jobs = raw.map((j) => NORM[co.ats](j, co)).filter((n) => n.url && n._listed !== false);
    const out = { at: Date.now(), checked_at: at, raw: jobs, error: null };
    cache.set(key, out);
    return out;
  } catch (e) {
    const out = { at: Date.now(), checked_at: at, raw: [], error: e.message };
    cache.set(key, { ...out, at: Date.now() - TTL + 60e3 }); // retry failed boards after a minute
    return out;
  }
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// ---------- search ----------
const BAY = ["san francisco", "sf", "bay area", "palo alto", "mountain view", "menlo park", "redwood city", "san mateo", "south san francisco", "foster city", "oakland", "berkeley", "san jose", "sunnyvale", "santa clara", "cupertino", "fremont", "emeryville", "burlingame", "san carlos", "hayward"];
const NYC = ["new york", "nyc", "brooklyn", "manhattan", "jersey city", "hoboken"];
function locationTerms(loc) {
  const l = loc.toLowerCase().trim();
  if (/bay area|^sf$|san francisco/.test(l)) return BAY;
  if (/^nyc$|new york/.test(l)) return NYC;
  return [l];
}
function matchesLocation(opp, locs, includeRemote) {
  if (!locs.length) return true;
  const hay = [opp.location, ...opp.locations].join(" | ").toLowerCase();
  if (includeRemote && /remote/.test(hay + " " + (opp.evidence.work_mode.value || "").toLowerCase())) return true;
  return locs.some((loc) => locationTerms(loc).some((t) => new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(hay)));
}
const INTERN = /\b(intern|internship|co-?op|summer (student|associate|analyst)|student researcher|fellow(ship)?)\b/i;
const NEWGRAD = /\b(new grad|graduate|early career|university grad|entry[- ]level|associate)\b/i;

// opts: { companies, keywords[], locations[], include_remote, level: "internship"|"early"|"any", exclude_ids[] }
async function search(companies, opts) {
  const results = await pool(companies, 6, (co) => fetchBoard(co).then((b) => ({ co, b })));
  const sources = results.map(({ co, b }) => ({ company: co.name, ats: co.ats, board: co.board, feed: FEEDS[co.ats](co.board).replace(/\?.*$/, ""), checked_at: b.checked_at, jobs: b.raw.length, error: b.error }));
  const kws = (opts.keywords || []).map((k) => k.toLowerCase().trim()).filter(Boolean);
  const excl = new Set(opts.exclude_ids || []);
  const seen = new Map();
  for (const { co, b } of results) {
    for (const n of b.raw) {
      const title = String(n.title || "");
      const lvl = opts.level || "internship";
      if (lvl === "internship" && !INTERN.test(`${title} ${n.type}`)) continue;
      if (lvl === "early" && !INTERN.test(`${title} ${n.type}`) && !NEWGRAD.test(title)) continue;
      if (kws.length && !kws.some((k) => `${title} ${n.department}`.toLowerCase().includes(k))) continue;
      const id = oppId(n.url);
      if (excl.has(id) || seen.has(id)) continue;
      const opp = toOpportunity(n, co, b.checked_at);
      if (!matchesLocation(opp, opts.locations || [], opts.include_remote !== false)) continue;
      // Deduplicate across sources: same company + same title + same location counts as one role.
      const dkey = `${opp.company}|${opp.title}|${opp.location}`.toLowerCase();
      if ([...seen.values()].some((o) => `${o.company}|${o.title}|${o.location}`.toLowerCase() === dkey)) continue;
      seen.set(id, opp);
    }
  }
  return { opportunities: [...seen.values()], sources };
}

// Re-check one saved opportunity against its source: open (still in the feed), closed (gone / 404), unclear.
async function checkStatus(opp, companies) {
  const at = new Date().toISOString();
  const co = companies.find((c) => c.ats === opp.source?.ats && c.board === opp.source?.board) || { name: opp.company, ats: opp.source?.ats, board: opp.source?.board };
  if (co.ats && FEEDS[co.ats]) {
    const b = await fetchBoard(co, { fresh: true });
    if (!b.error) {
      const n = b.raw.find((x) => String(x.job_id) === String(opp.source.job_id) || canon(x.url) === opp.canonical_url);
      if (n) return { status: "open", fresh: toOpportunity(n, co, b.checked_at), status_evidence: { method: "listed_in_feed", checked_at: at, source_url: FEEDS[co.ats](co.board).replace(/\?.*$/, "") } };
    }
  }
  try {
    const r = await fetch(opp.canonical_url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "BootOutreach/1.0" } });
    if (r.status === 404 || r.status === 410) return { status: "closed", status_evidence: { method: `posting_http_${r.status}`, checked_at: at, source_url: opp.canonical_url } };
    const body = r.ok ? (await r.text()).slice(0, 200000) : "";
    if (/no longer (accepting|available|open)|position (has been )?(filled|closed)|job (is )?(not found|closed)/i.test(body)) return { status: "closed", status_evidence: { method: "posting_says_closed", checked_at: at, source_url: opp.canonical_url } };
    return { status: "unclear", status_evidence: { method: `not_in_feed_page_http_${r.status}`, checked_at: at, source_url: opp.canonical_url } };
  } catch (e) {
    return { status: "unclear", status_evidence: { method: "fetch_failed: " + e.message, checked_at: at, source_url: opp.canonical_url } };
  }
}

module.exports = { search, checkStatus, fetchBoard, htmlToText, extractEvidence, canon, oppId, FEEDS };
