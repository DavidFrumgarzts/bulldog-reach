// Resume: onboarding (resume + LinkedIn PDF), in-app editor, per-opportunity tailoring with
// accept/reject suggestions (nothing changes without the student's OK), Word + PDF export.
// Uses globals from index.html: $, esc, call, toast, CART.
const RS = { resume: null, mode: "base", cartId: null, doc: null, tailored: null, saveT: null };
const SECTION_TITLES = { education: "Education", experience: "Experience", projects: "Projects", leadership: "Leadership & Activities", skills: "Skills" };

// ---------------- onboarding ----------------
async function loadResume() {
  try {
    const { resume } = await call("/api/resume", { method: "GET" });
    RS.resume = resume;
  } catch { RS.resume = null; }
  paintOnboarding();
}
function paintOnboarding() {
  const has = !!RS.resume?.base;
  $("#onboard").hidden = has || localStorage.bb_skip_onboard === "1";
  $("#resumebtn").textContent = has ? "My resume" : "Add resume";
  if (has && !$("#about").value) $("#about").value = aboutFromResume(RS.resume.base);
}
function aboutFromResume(r) {
  const ed = r.education?.[0];
  const roles = (r.experience || []).slice(0, 3).map((e) => `${e.role} at ${e.org}`).join("; ");
  const skills = (r.skills || []).flatMap((s) => s.items).slice(0, 10).join(", ");
  return [ed && `${ed.degree || ""} ${ed.school || ""} ${ed.dates || ""}`.trim(), roles, skills && "Skills: " + skills].filter(Boolean).join(" · ");
}
function skipOnboarding() { localStorage.bb_skip_onboard = "1"; paintOnboarding(); }

async function extractText(file) {
  if (!file) return "";
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith(".pdf")) {
    const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      // Workers must be same-origin: load the worker code and run it from a blob URL.
      const code = await fetch("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs").then((r) => r.text());
      pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    }
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let out = "";
    for (let p = 1; p <= Math.min(pdf.numPages, 6); p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      let lastY = null;
      for (const it of tc.items) {
        const y = it.transform?.[5];
        out += (lastY !== null && Math.abs(y - lastY) > 2 ? "\n" : " ") + it.str;
        lastY = y;
      }
      out += "\n\n";
    }
    return out.replace(/[ \t]+/g, " ").trim();
  }
  if (name.endsWith(".docx")) {
    if (!window.mammoth) await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js"; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
    return (await window.mammoth.extractRawText({ arrayBuffer: buf })).value.trim();
  }
  return new TextDecoder().decode(buf).trim();
}

async function submitOnboarding(e) {
  e.preventDefault();
  const rf = $("#rfile").files[0], lf = $("#lfile").files[0];
  if (!rf && !lf) return ($("#onberr").textContent = "Add your resume (PDF or Word).");
  $("#onberr").textContent = "";
  $("#onbbtn").disabled = true; $("#onbbtn").textContent = "Reading your files…";
  try {
    const [resume_text, linkedin_text] = await Promise.all([extractText(rf), extractText(lf)]);
    $("#onbbtn").textContent = "Grok is structuring your resume…";
    const { resume } = await call("/api/resume/parse", { body: { resume_text, linkedin_text, linkedin_url: $("#lurl").value.trim(), source_names: [rf?.name, lf?.name].filter(Boolean) } });
    RS.resume = resume;
    paintOnboarding();
    toast("Resume ready — check it for accuracy");
    openResume();
  } catch (err) {
    $("#onberr").textContent = err.message;
  } finally {
    $("#onbbtn").disabled = false; $("#onbbtn").textContent = "Read my resume →";
  }
}

// ---------------- workspace (editor + suggestions) ----------------
function openResume() {
  if (!RS.resume?.base) { $("#onboard").hidden = false; localStorage.removeItem("bb_skip_onboard"); $("#onboard").scrollIntoView({ behavior: "smooth" }); return; }
  RS.mode = "base"; RS.cartId = null; RS.tailored = null;
  RS.doc = structuredClone(RS.resume.base);
  $("#rw").hidden = false;
  paintWorkspace();
}
async function openTailor(cartId) {
  if (!RS.resume?.base) { $("#item").hidden = true; toast("Add your resume first"); return openResume(); }
  RS.mode = "tailor"; RS.cartId = cartId;
  $("#item").hidden = true; $("#rw").hidden = false;
  $("#rwside").innerHTML = `<p class="loading"><i></i>Loading…</p>`;
  const { tailored } = await call("/api/tailor/" + cartId, { method: "GET" });
  RS.tailored = tailored;
  RS.doc = structuredClone(tailored?.resume || RS.resume.base);
  paintWorkspace();
}
async function generateSuggestions() {
  $("#rwside").innerHTML = `<p class="loading"><i></i>Grok is reading the opportunity and your resume… (~15s)</p>`;
  try {
    const { tailored } = await call("/api/tailor/" + RS.cartId, {});
    RS.tailored = tailored; RS.doc = structuredClone(tailored.resume);
    paintWorkspace();
  } catch (e) { $("#rwside").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

function paintWorkspace() {
  const it = RS.cartId ? CART.items.find((i) => i.id === RS.cartId) : null;
  $("#rwtitle").innerHTML = RS.mode === "tailor" ? `Tailored for <span style="color:var(--amber)">${esc(it?.opp.title || "this opportunity")}</span>` : "Your base resume";
  $("#rwdoc").innerHTML = renderDoc(RS.doc, true);
  bindDoc();
  paintSide();
}

function paintSide() {
  const side = $("#rwside");
  if (RS.mode === "base") {
    side.innerHTML = `<div class="k">Base resume</div>
      <p class="why" style="font-size:14px">This is what Grok read from your files. <b style="color:#fff">Check every line</b> — click any text to edit it. Changes save automatically.</p>
      <p class="why" style="font-size:14px">To tailor it, open an opportunity on your list and press “✨ Tailor my resume”. Your base resume never changes from tailoring.</p>
      <button class="linkbtn" onclick="$('#rw').hidden=true;$('#onboard').hidden=false;localStorage.removeItem('bb_skip_onboard');$('#onboard').scrollIntoView()">Re-upload files</button>`;
    return;
  }
  const T = RS.tailored;
  if (!T?.suggestions?.length) {
    side.innerHTML = `<div class="k">Tailoring</div><p class="why" style="font-size:14px">Grok will suggest edits for this opportunity: wording, order, keywords, and where a number would help. <b style="color:#fff">Nothing changes until you accept it.</b></p>
      <button class="cta" style="width:auto;height:52px;padding:0 22px;font-size:16px;border-radius:14px" onclick="generateSuggestions()">Suggest edits →</button>`;
    return;
  }
  const dec = T.decisions || {};
  const pending = T.suggestions.filter((s) => !dec[s.id]).length;
  side.innerHTML = `<div class="k">${pending} suggestion${pending === 1 ? "" : "s"} to review</div>
    ${T.fit_notes ? `<p class="why" style="font-size:14px">${esc(T.fit_notes)}</p>` : ""}
    ${(T.keywords || []).length ? `<div class="yt" style="margin-bottom:14px">${T.keywords.map((k) => `<span>${esc(k)}</span>`).join("")}</div>` : ""}
    ${T.suggestions.map((s) => `
      <div class="sug ${dec[s.id] || ""}">
        <div class="sugk">${esc(KIND_LABEL[s.kind] || s.kind)}${s.needs_input ? ` · <span style="color:#FFE27A">you fill in the number</span>` : ""}</div>
        ${s.before ? `<div class="sugb">${esc(s.before)}</div>` : ""}
        ${s.after ? `<div class="suga">${hl(esc(s.after))}</div>` : ""}
        ${s.order?.length ? `<div class="suga">New order: ${esc(describeOrder(s))}</div>` : ""}
        <div class="why">${esc(s.reason)}</div>
        ${(s.new_terms || []).length ? `<div class="newt">⚠ New wording not in your resume — only accept if true: <b>${s.new_terms.map(esc).join(", ")}</b></div>` : ""}
        ${dec[s.id] ? `<div class="sugd">${dec[s.id] === "accepted" ? "✓ Accepted" : "Skipped"} <button class="linkbtn" style="font-size:13px" onclick="undoDecision('${s.id}')">undo</button></div>` :
          `<div class="row3"><button class="whitebtn smallbtn" onclick="decide('${s.id}','accepted')">Accept</button><button class="glassbtn smallbtn" onclick="decide('${s.id}','rejected')">Skip</button></div>`}
      </div>`).join("")}
    <button class="linkbtn" onclick="generateSuggestions()">Regenerate suggestions</button>`;
}
const KIND_LABEL = { rewrite_bullet: "Reword", reorder_bullets: "Reorder bullets", reorder_items: "Reorder entries", reorder_sections: "Reorder sections", hide_item: "De-emphasize", add_skill: "Add skill", edit_summary: "Summary" };
const hl = (h) => h.replace(/\[[^\]]{1,30}\]/g, (m) => `<mark>${m}</mark>`);
function describeOrder(s) {
  if (s.kind === "reorder_sections") return s.order.map((x) => SECTION_TITLES[x] || x).join(" → ");
  const sec = RS.doc[s.target?.section] || [];
  if (s.kind === "reorder_items") return s.order.map((id) => { const it = sec.find((i) => i.id === id); return it ? it.org || it.name || it.school : id; }).join(" → ");
  return "bullets " + s.order.join(", ");
}

// Apply ONE accepted suggestion to the working copy. Returns false if it no longer applies.
function applySuggestion(doc, s) {
  const t = s.target || {};
  const sec = Array.isArray(doc[t.section]) ? doc[t.section] : null;
  const item = sec?.find((i) => i.id === t.item_id);
  const reorder = (arr, order) => { const byId = new Map(arr.map((x) => [x.id, x])); const out = order.map((id) => byId.get(id)).filter(Boolean); return out.concat(arr.filter((x) => !order.includes(x.id))); };
  switch (s.kind) {
    case "rewrite_bullet": { const b = item?.bullets.find((x) => x.id === t.bullet_id); if (!b) return false; b.text = s.after; return true; }
    case "reorder_bullets": if (!item) return false; item.bullets = reorder(item.bullets, s.order || []); return true;
    case "reorder_items": if (!sec) return false; doc[t.section] = reorder(sec, s.order || []); return true;
    case "reorder_sections": doc.section_order = [...new Set([...(s.order || []).filter((x) => SECTION_TITLES[x]), ...doc.section_order])]; return true;
    case "hide_item": if (!item) return false; item.hidden = true; return true;
    case "add_skill": { let g = doc.skills.find((x) => x.id === t.skill_id) || doc.skills[0]; if (!g) { g = { id: "sk" + Date.now(), label: "Skills", items: [] }; doc.skills.push(g); } if (!g.items.includes(s.after)) g.items.push(s.after); return true; }
    case "edit_summary": doc.summary = s.after; return true;
  }
  return false;
}
async function decide(id, d) {
  const s = RS.tailored.suggestions.find((x) => x.id === id);
  if (d === "accepted" && !applySuggestion(RS.doc, s)) { toast("That part of your resume changed — skipped this one"); d = "rejected"; }
  RS.tailored.decisions = { ...(RS.tailored.decisions || {}), [id]: d };
  $("#rwdoc").innerHTML = renderDoc(RS.doc, true); bindDoc(); paintSide();
  await saveDoc(true);
  if (d === "accepted" && s.needs_input) toast("Fill in the highlighted [placeholder] with your real number");
}
function undoDecision(id) {
  // Undo = rebuild from the original snapshot + every other accepted suggestion.
  const dec = { ...RS.tailored.decisions }; delete dec[id];
  RS.tailored.decisions = dec;
  RS.doc = structuredClone(RS.tailored.resume);
  for (const s of RS.tailored.suggestions) if (dec[s.id] === "accepted") applySuggestion(RS.doc, s);
  $("#rwdoc").innerHTML = renderDoc(RS.doc, true); bindDoc(); paintSide(); saveDoc(true);
  toast("Undone (manual edits made after accepting may need redoing)");
}

// ---------------- document rendering + editing ----------------
function renderDoc(r, editable) {
  const ce = (path, text, cls = "", tag = "span") => editable ? `<${tag} class="${cls}" contenteditable="true" spellcheck="true" data-k="${path}">${hl(esc(text || ""))}</${tag}>` : `<${tag} class="${cls}">${esc(text || "")}</${tag}>`;
  const c = r.contact || {};
  const contact = [["contact.email", c.email], ["contact.phone", c.phone], ["contact.location", c.location], ...(c.links || []).map((l, i) => [`contact.links.${i}`, l])]
    .filter(([, v]) => v).map(([k, v]) => ce(k, v)).join(" · ");
  const head = (sec, it, i) => {
    const p = `${sec}.${i}`;
    if (sec === "education") return `<div class="rh">${ce(p + ".school", it.school, "b")}${ce(p + ".dates", it.dates, "rd")}</div><div class="rs">${ce(p + ".degree", it.degree, "i")}${it.location ? ce(p + ".location", it.location, "rd") : ""}</div>`;
    if (sec === "projects") return `<div class="rh">${ce(p + ".name", it.name, "b")}${ce(p + ".dates", it.dates, "rd")}</div>`;
    return `<div class="rh"><span>${ce(p + ".role", it.role, "b")}${it.org ? `, ${ce(p + ".org", it.org)}` : ""}</span>${ce(p + ".dates", it.dates, "rd")}</div>`;
  };
  const section = (sec) => {
    if (sec === "skills") return (r.skills || []).length ? `<h3 class="rsec">Skills</h3>${r.skills.map((g, i) => `<div class="rskill">${ce(`skills.${i}.label`, g.label, "b")}: ${ce(`skills.${i}.items`, g.items.join(", "))}</div>`).join("")}` : "";
    const items = (r[sec] || []).map((it, i) => ({ it, i })).filter(({ it }) => editable || !it.hidden);
    if (!items.length) return "";
    return `<h3 class="rsec">${SECTION_TITLES[sec]}</h3>` + items.map(({ it, i }) => `
      <div class="ritem ${it.hidden ? "rhidden" : ""}">
        ${editable ? `<button class="rtoggle" onclick="toggleHidden('${sec}',${i})" title="${it.hidden ? "Show on resume" : "Hide from this resume"}">${it.hidden ? "hidden · show" : "hide"}</button>` : ""}
        ${head(sec, it, i)}
        <ul>${it.bullets.map((b, j) => `<li>${ce(`${sec}.${i}.bullets.${j}.text`, b.text)}</li>`).join("")}</ul>
      </div>`).join("");
  };
  return `<div class="paper">
    <h1 class="rname">${ce("name", r.name, "", "span")}</h1>
    <div class="rcontact">${contact}</div>
    ${r.summary || editable ? `<p class="rsum">${ce("summary", r.summary || (editable ? "" : ""))}</p>` : ""}
    ${r.section_order.map(section).join("")}
  </div>`;
}
function bindDoc() {
  $("#rwdoc").querySelectorAll("[data-k]").forEach((el) => {
    el.oninput = () => {
      setPath(RS.doc, el.dataset.k, el.textContent);
      $("#rwsave").textContent = "Editing…";
      clearTimeout(RS.saveT); RS.saveT = setTimeout(() => saveDoc(false), 900);
    };
  });
}
function setPath(obj, path, val) {
  const ks = path.split(".");
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; }
  const last = ks[ks.length - 1];
  if (path.startsWith("skills.") && last === "items") o.items = val.split(",").map((s) => s.trim()).filter(Boolean);
  else o[last] = val.trim();
}
function toggleHidden(sec, i) { RS.doc[sec][i].hidden = !RS.doc[sec][i].hidden; $("#rwdoc").innerHTML = renderDoc(RS.doc, true); bindDoc(); saveDoc(false); }

async function saveDoc(quiet) {
  $("#rwsave").textContent = "Saving…";
  try {
    if (RS.mode === "base") { const { resume } = await call("/api/resume", { method: "PUT", body: { base: RS.doc } }); RS.resume = resume; }
    else { const { tailored } = await call("/api/tailor/" + RS.cartId, { method: "PUT", body: { resume: RS.doc, decisions: RS.tailored?.decisions || {} } }); RS.tailored = { ...RS.tailored, ...tailored, resume: RS.tailored?.resume || tailored.resume }; }
    $("#rwsave").textContent = "Saved ✓";
  } catch (e) { $("#rwsave").textContent = "Not saved: " + e.message; }
}

// ---------------- export ----------------
function fileBase() {
  const it = RS.cartId ? CART.items.find((i) => i.id === RS.cartId) : null;
  return ((RS.doc.name || "resume") + (it ? " - " + it.opp.org : "")).replace(/[^\w .-]+/g, "").trim();
}
// True if any visible text still has an unfilled "[X%]"-style placeholder from a suggestion.
function hasPlaceholders() {
  const texts = [];
  const walk = (v) => { if (typeof v === "string") texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "section_order" && k !== "id") walk(x); };
  walk(RS.doc);
  return texts.some((t) => /\[[^\]]{1,30}\]/.test(t));
}

async function downloadDocx() {
  if (hasPlaceholders()) return toast("Fill in the highlighted [placeholders] first");
  const D = await import("https://esm.sh/docx@9.0.2");
  const { Document, Packer, Paragraph, TextRun, AlignmentType, TabStopType, BorderStyle } = D;
  const r = RS.doc, c = r.contact || {};
  const RIGHT = 10080; // 7in content width in twips
  const P = [];
  P.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: r.name || "", bold: true, size: 32 })] }));
  P.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: [c.email, c.phone, c.location, ...(c.links || [])].filter(Boolean).join("  ·  "), size: 19 })] }));
  if (r.summary) P.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: r.summary, size: 20 })] }));
  const heading = (t) => new Paragraph({ spacing: { before: 160, after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 1 } }, children: [new TextRun({ text: t.toUpperCase(), bold: true, size: 21 })] });
  const line = (left, right, italic) => new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: RIGHT }], children: [new TextRun({ text: left, bold: !italic, italics: !!italic, size: 20 }), ...(right ? [new TextRun({ text: "\t" + right, size: 20 })] : [])] });
  for (const sec of r.section_order) {
    if (sec === "skills") {
      if (!r.skills.length) continue;
      P.push(heading("Skills"));
      for (const g of r.skills) P.push(new Paragraph({ children: [new TextRun({ text: g.label + ": ", bold: true, size: 20 }), new TextRun({ text: g.items.join(", "), size: 20 })] }));
      continue;
    }
    const items = (r[sec] || []).filter((i) => !i.hidden);
    if (!items.length) continue;
    P.push(heading(SECTION_TITLES[sec]));
    for (const it of items) {
      if (sec === "education") { P.push(line(it.school, it.dates)); if (it.degree) P.push(line(it.degree, it.location, true)); }
      else if (sec === "projects") P.push(line(it.name, it.dates));
      else P.push(line([it.role, it.org].filter(Boolean).join(", "), it.dates));
      for (const b of it.bullets) P.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b.text, size: 20 })] }));
    }
  }
  const doc = new Document({ styles: { default: { document: { run: { font: "Times New Roman" } } } }, sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 1080, right: 1080 } } }, children: P }] });
  const blob = await Packer.toBlob(doc);
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: fileBase() + ".docx" });
  document.body.appendChild(a); a.click(); a.remove();
}

function downloadPdf() {
  if (hasPlaceholders()) return toast("Fill in the highlighted [placeholders] first");
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to download the PDF");
  w.document.write(`<!DOCTYPE html><html><head><title>${esc(fileBase())}</title><style>${PRINT_CSS}</style></head><body>${renderDoc(RS.doc, false)}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
  w.document.close();
}
const PRINT_CSS = `@page{size:letter;margin:0.5in 0.75in}body{margin:0;font:10.5pt/1.3 "Times New Roman",Times,serif;color:#000}
.paper{max-width:7in;margin:0 auto}.rname{font-size:18pt;text-align:center;margin:0}.rcontact{text-align:center;font-size:9.5pt;margin:2px 0 8px}
.rsum{margin:0 0 6px}.rsec{font-size:10.5pt;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #000;margin:10px 0 4px;padding-bottom:1px}
.ritem{margin-bottom:5px;break-inside:avoid}.rh,.rs{display:flex;justify-content:space-between;gap:12px}.b{font-weight:bold}.i{font-style:italic}
ul{margin:2px 0 0 18px;padding:0}li{margin:0 0 1px}.rskill{margin-bottom:2px}`;
