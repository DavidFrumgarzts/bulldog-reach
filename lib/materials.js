// Application materials built only from the user's claims ledger (no model calls).
// Every draft carries: the claim ids it used, and flags the user must resolve or explicitly acknowledge.
const crypto = require("crypto");
const { support, words, usable } = require("./fit");

const NUM = /(?:\$\s?\d[\d,.]*\s?[kKmMbB]?|\b\d[\d,.]*\s?(?:%|percent|x\b|k\b|m\b|\+)|\b\d{2,}[\d,.]*\b)/g;

function applyCorrections(text, corrections = []) {
  let out = String(text || "");
  for (const c of corrections) if (c && c.from) out = out.split(c.from).join(c.to || "");
  return out;
}

// Flags for any piece of text the user might send or submit.
function flagsFor(text, { claims = [], profile = {}, usedClaimIds = [] } = {}) {
  const flags = [];
  const t = String(text || "");
  const byId = new Map(claims.map((c) => [c.id, c]));
  const verifiedText = claims.filter((c) => c.status === "verified").map((c) => `${c.preferred_wording || ""} ${c.text || ""} ${c.dates || ""} ${c.title || ""}`).join(" \n ");
  const nums = [...new Set(t.match(NUM) || [])].filter((n) => !/^(19|20)\d\d$/.test(n.trim()));
  for (const n of nums) if (!verifiedText.includes(n.trim())) flags.push({ id: "num:" + n.trim(), kind: "unsupported_number", message: `"${n.trim()}" isn't in any of your verified claims.` });
  for (const m of t.match(/\[[^\]]{1,240}\]/g) || []) flags.push({ id: "ph:" + m, kind: "placeholder", message: `Placeholder to fill: ${m}` });
  for (const id of usedClaimIds) {
    const c = byId.get(id);
    if (!c) flags.push({ id: "claim:" + id, kind: "missing_claim", message: "Uses a claim that no longer exists." });
    else if (c.status === "approximate") flags.push({ id: "approx:" + id, kind: "approximate_claim", message: `Uses an approximate claim: "${(c.preferred_wording || c.text).slice(0, 100)}". Approve the wording before it goes out.` });
    else if (!usable(c)) flags.push({ id: "unconfirmed:" + id, kind: "unconfirmed_claim", message: `Uses a claim that isn't verified (${c.status}).` });
  }
  for (const ex of profile.exclusions || []) if (ex && t.toLowerCase().includes(String(ex).toLowerCase())) flags.push({ id: "excl:" + ex, kind: "excluded_phrase", message: `Contains "${ex}", which you asked never to use.` });
  return flags;
}

const line = (c) => (c.preferred_wording || c.text || "").trim();

async function coverLetter({ opp, profile = {}, claims = [] }) {
  // Pick the three claims closest in meaning to the role's requirements (then to the role itself).
  const reqs = opp.evidence?.required_qualifications?.value || [];
  const picked = [];
  for (const r of reqs) for (const s of await support(r, claims, 2)) if (!picked.includes(s.id)) picked.push(s.id);
  if (picked.length < 3) for (const s of await support(`${opp.title}. ${opp.department || ""}`, claims, 5)) if (!picked.includes(s.id) && picked.length < 3) picked.push(s.id);
  const use = picked.slice(0, 3).map((id) => claims.find((c) => c.id === id)).filter(Boolean);
  const name = profile.name || "[Your name]";
  const school = profile.school ? ` at ${profile.school}` : "";
  const body = [
    `Dear ${opp.company} hiring team,`,
    "",
    `I'm applying for the ${opp.title} role. I'm ${profile.year_label ? `a ${profile.year_label}` : "a student"}${school}${profile.majors ? ` studying ${profile.majors}` : ""}, and [Why ${opp.company}, in one specific sentence].`,
    "",
    use.length ? "What I'd bring:" : "[Add two or three experiences that match the role. Confirm claims in Profile → Claims and redraft.]",
    ...use.map((c) => `• ${line(c)}${c.org && !line(c).toLowerCase().includes(c.org.toLowerCase().split(/[\s/]+/)[0]) ? ` (${c.org})` : ""}`),
    "",
    `[One sentence on what you want to learn or own in this role.]`,
    "",
    "Thank you for your consideration.",
    name,
  ].join("\n");
  const text = applyCorrections(body, profile.corrections);
  return { text, claim_ids: use.map((c) => c.id), flags: flagsFor(text, { claims, profile, usedClaimIds: use.map((c) => c.id) }) };
}

// Suggest an answer for one application question: reuse the best approved library answer, else claims.
async function answerDraft({ question, opp, profile = {}, claims = [], library = [] }) {
  // Reuse the approved library answer whose question means the same thing (local model); keyword overlap if unavailable.
  const lib = library.filter((a) => a.approved_at);
  let best = null;
  if (lib.length) {
    try {
      const sem = require("./semantic");
      const [[qv], lv] = await Promise.all([sem.embed([question]), sem.embed(lib.map((a) => a.question))]);
      const top = lib.map((a, i) => ({ a, s: sem.cos(qv, lv[i]) })).sort((x, y) => y.s - x.s)[0];
      if (top && top.s >= 0.62) best = top.a;
    } catch {
      const qw = new Set(words(question));
      const top = lib.map((a) => ({ a, n: words(`${a.question} ${(a.tags || []).join(" ")}`).filter((w) => qw.has(w)).length })).sort((x, y) => y.n - x.n)[0];
      if (top && top.n >= 2) best = top.a;
    }
  }
  const supportIds = (await support(`${question} ${opp?.title || ""}`, claims)).map((s) => s.id);
  let text, reused = null;
  if (best) {
    text = applyCorrections(best.answer, profile.corrections);
    reused = { answer_id: best.id, reconfirm: !!best.reconfirm };
  } else {
    const use = supportIds.map((id) => claims.find((c) => c.id === id)).filter(Boolean);
    text = use.length ? `[Draft from your claims — rewrite in your own words]\n${use.map((c) => "• " + line(c)).join("\n")}` : "[No matching approved answer or claim. Write this one yourself, then save it to the answer library.]";
  }
  const claimIds = best ? best.claim_ids || [] : supportIds;
  const flags = flagsFor(text, { claims, profile, usedClaimIds: claimIds });
  if (reused?.reconfirm) flags.push({ id: "reconfirm:" + reused.answer_id, kind: "reconfirm", message: "Reused answer is marked 'reconfirm before reuse'. Check it's still true." });
  return { text, claim_ids: claimIds, reused, flags };
}

async function outreachDraft({ contact, opp, profile = {}, claims = [], channel = "email" }) {
  const first = String(contact.name || "").split(/\s+/)[0].replace(/,$/, "") || "[Name]";
  const c = opp ? (await support(`${opp.title}. ${opp.department || ""}`, claims, 1))[0] : null;
  const claim = c && claims.find((x) => x.id === c.id);
  const shared = contact.shared_context || "[How you're connected, or one specific thing they did]";
  const me = `${profile.name || "[Your name]"}${profile.school ? ` (${profile.school})` : ""}`;
  const ask = opp ? `Would you be open to a short chat about the ${opp.title} role at ${opp.company}?` : "Would you be open to a short chat?";
  let body;
  if (channel === "linkedin") {
    // LinkedIn connection notes are capped at 300 characters: drop the claim line before cutting anything.
    const withClaim = claim ? `Hi ${first}, ${shared}. I'm ${me}. I ${line(claim).replace(/\.$/, "").replace(/^./, (x) => x.toLowerCase())}. ${ask}` : `Hi ${first}, ${shared}. I'm ${me}. ${ask}`;
    body = withClaim.length <= 300 ? withClaim : `Hi ${first}, ${shared}. I'm ${me}. ${ask}`;
  } else {
    body = `Hi ${first},\n\n${shared}.\n\nI'm ${me}.${claim ? ` ${line(claim)}` : ""}\n\n${ask}\n\nThanks,\n${profile.name || "[Your name]"}`;
  }
  const text = applyCorrections(body, profile.corrections);
  return { text, claim_ids: claim ? [claim.id] : [], flags: flagsFor(text, { claims, profile, usedClaimIds: claim ? [claim.id] : [] }) };
}

// The exact packet the user approves. Its hash ties the approval to this content.
function packet(app, opp) {
  const m = app.materials || {};
  const parts = [
    `# Application packet: ${opp?.title || app.title} at ${opp?.company || app.company}`,
    `Destination: ${opp?.apply_url || app.url || "(not set)"}`,
    `Posting: ${opp?.canonical_url || app.url || ""} (last checked ${opp?.last_checked || "never"}, status ${opp?.status || "not checked"})`,
    "",
    "## Resume",
    m.resume?.text || "(none)",
    "",
    "## Cover letter",
    m.cover_letter?.text || "(none)",
    "",
    "## Application questions",
    ...(m.questions || []).flatMap((q, i) => [`### ${i + 1}. ${q.question}`, q.answer || "(no answer)", ""]),
    "## Unresolved",
    ...unresolved(app).map((u) => "- " + u),
  ];
  const text = parts.join("\n");
  return { text, hash: crypto.createHash("sha256").update(text).digest("hex").slice(0, 16) };
}

function artifacts(app) {
  const m = app.materials || {};
  return [
    m.resume && { key: "resume", label: "Resume", a: m.resume },
    m.cover_letter && { key: "cover_letter", label: "Cover letter", a: m.cover_letter },
    ...(m.questions || []).map((q) => ({ key: "q:" + q.id, label: `Answer: ${q.question.slice(0, 60)}`, a: q })),
  ].filter(Boolean);
}
const openFlags = (a) => (a.flags || []).filter((f) => !(a.acknowledged || []).includes(f.id));

function unresolved(app) {
  const out = [];
  const arts = artifacts(app);
  if (!arts.some((x) => x.key === "resume")) out.push("No resume version attached.");
  for (const x of arts) {
    if (!x.a.approved_at) out.push(`${x.label}: not approved yet.`);
    const f = openFlags(x.a);
    if (f.length) out.push(`${x.label}: ${f.length} open flag${f.length > 1 ? "s" : ""}.`);
  }
  return out;
}

module.exports = { flagsFor, coverLetter, answerDraft, outreachDraft, packet, unresolved, artifacts, openFlags, applyCorrections };
