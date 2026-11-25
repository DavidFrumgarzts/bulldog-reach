// "Ask Bulldog": a back-and-forth assistant in the Workspace that can use the app itself.
// The conversation runs on the user's writing model (Basic = Haiku, Pro = Sonnet). Live web search is a tool that
// hands the query to the search model (Sonnet + web_search) and returns findings with source URLs.
// It can read and organize the user's data, but it never sends a message or submits an application.

const MAX_TURN_STEPS = 8; // model calls per user message
const MAX_WEB_SEARCHES = 3; // per user message (each one is a paid Sonnet search call)
const MAX_THREAD_MESSAGES = 60; // after this the user starts a new chat (history is append-only)

const SYSTEM = `You are Bulldog, a job-search assistant inside Bulldog Reach, working for one student.
How you work:
- Find real, current opportunities. Prefer official employer pages and the job boards tool. Every role, deadline, salary or person you mention needs a source URL from a tool result. If you don't have one, say it's unknown.
- Keep fit and eligibility separate. Never tell the student they are eligible, that a company sponsors visas, or that CPT/OPT is accepted unless a posting says so; quote the posting and suggest asking the employer or their school's international office.
- Never invent the student's experience, numbers, titles or dates. Use only their confirmed claims (get_my_profile). If something is missing, ask them.
- You can save roles, add applications and add contacts when the student asks or clearly agrees. You cannot send messages or submit applications; drafts are for the student to review.
- Be brief and concrete. Lists over paragraphs. Ask one clarifying question when the request is vague instead of guessing.`;

const TOOLS = [
  { name: "search_job_boards", description: "Search official employer job boards (Greenhouse, Lever, Ashby) for the student's tracked companies. Results are ranked by meaning against the student's interests and include fit, eligibility notes and the posting URL. Free and fast: use this first for jobs and internships.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What the student is looking for, in plain words" }, locations: { type: "array", items: { type: "string" }, description: "e.g. NYC, Bay Area, Remote" }, level: { type: "string", enum: ["internship", "early", "any"] }, title_must_contain: { type: "array", items: { type: "string" } } }, required: ["query"] } },
  { name: "search_web", description: "Search the live web for things the job boards don't cover: research labs, fellowships, programs, companies not tracked, people to contact, recent posts or news. Slower and costs money: use only when needed, at most a few times per answer.",
    input_schema: { type: "object", properties: { query: { type: "string" }, purpose: { type: "string", description: "What you need from this search" } }, required: ["query"] } },
  { name: "get_opportunity", description: "Full details and quoted evidence (deadline, pay, work mode, sponsorship, work authorization, requirements) for one opportunity id from search_job_boards or the pipeline.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "save_opportunity", description: "Save a job-board opportunity to the student's pipeline (creates an application at 'shortlisted'). Only when the student asks or agrees.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "add_application", description: "Add a role found on the web (not on the job boards) to the pipeline at 'researching'. Only when the student asks or agrees.",
    input_schema: { type: "object", properties: { title: { type: "string" }, company: { type: "string" }, url: { type: "string" }, deadline: { type: "string", description: "YYYY-MM-DD, only if a source states it" }, notes: { type: "string" } }, required: ["title", "company"] } },
  { name: "list_pipeline", description: "The student's applications: stage, deadline, next action and what's blocking each.", input_schema: { type: "object", properties: {} } },
  { name: "get_my_profile", description: "The student's preferences, confirmed eligibility facts and confirmed experience claims (the only facts you may use about them).", input_schema: { type: "object", properties: {} } },
  { name: "find_contacts", description: "People the student already knows or has saved at a company (from their LinkedIn export or added by hand).",
    input_schema: { type: "object", properties: { company: { type: "string" } }, required: ["company"] } },
  { name: "add_contact", description: "Save a person found on the web as an unverified contact. Only when the student asks or agrees. Include the source URL.",
    input_schema: { type: "object", properties: { name: { type: "string" }, company: { type: "string" }, role: { type: "string" }, profile_url: { type: "string" }, source_url: { type: "string" }, notes: { type: "string" } }, required: ["name", "source_url"] } },
];

module.exports = function makeAgent({ ai, R, h }) {
  // h: helpers from boot.js (profileOf, runSearch, summary, ensureApp, blockersFor, putApp, putContact, usable)
  const clip = (s, n) => String(s ?? "").slice(0, n);

  async function runTool(uid, user, name, input, state) {
    switch (name) {
      case "search_job_boards": {
        const r = await h.runSearch(uid, { query: clip(input.query, 300), locations: input.locations || [], level: input.level || "internship", keywords: input.title_must_contain || [] });
        state.activity.push({ type: "boards", text: `Searched ${r.sources.length} official job boards: ${r.opportunities.length} roles` });
        return { count: r.opportunities.length, results: r.opportunities.slice(0, 12).map((o) => ({ id: o.id, title: o.title, company: o.company, location: o.location, url: o.canonical_url, interest_fit: o.fit?.interest?.score, why: (o.fit?.interest?.reasons || []).slice(0, 2), experience_fit: o.fit?.experience?.score, eligibility: o.fit?.eligibility?.label, term: o.evidence?.term?.value || "not stated", pay: o.evidence?.compensation?.value || "not stated", saved: o.user_state === "saved" })) };
      }
      case "search_web": {
        if (state.webSearches >= MAX_WEB_SEARCHES) return { error: `Web search limit for this answer reached (${MAX_WEB_SEARCHES}). Answer with what you have.` };
        state.webSearches++;
        await ai.bump(user, "websearch");
        const out = await ai.search("Search the web and report what you find for a student's job search. List each finding as one line with its source URL. Say plainly when something is unknown or unconfirmed. No commentary.", `${clip(input.query, 400)}${input.purpose ? `\n\nPurpose: ${clip(input.purpose, 300)}` : ""}`);
        state.activity.push({ type: "web", text: `Searched the web (${ai.models.search}): ${clip(input.query, 80)}` });
        return { findings: clip(out.text, 6000), searches_run: out.searches };
      }
      case "get_opportunity": {
        const o = await R.get(uid, "opp", clip(input.id, 60));
        if (!o) return { error: "No opportunity with that id." };
        const ev = o.evidence || {};
        const pick = (k) => (ev[k]?.value ? { value: ev[k].value, quote: ev[k].quote || "", source: ev[k].source_url } : "not stated");
        return { id: o.id, title: o.title, company: o.company, location: o.location, url: o.canonical_url, apply_url: o.apply_url, status: o.status, last_checked: o.last_checked,
          deadline: pick("deadline"), term: pick("term"), pay: pick("compensation"), work_mode: pick("work_mode"), sponsorship: pick("sponsorship"), work_authorization: pick("work_authorization"), cpt_opt: pick("cpt_opt"),
          requirements: ev.required_qualifications?.value || "not stated", fit: { interest: o.fit?.interest, experience: { score: o.fit?.experience?.score, unmatched: o.fit?.experience?.unmatched }, eligibility: o.fit?.eligibility }, description_excerpt: clip(o.description, 2500) };
      }
      case "save_opportunity": {
        const o = await R.patch(uid, "opp", clip(input.id, 60), (x) => ({ ...x, user_state: "saved" }));
        if (!o) return { error: "No opportunity with that id." };
        const app = await h.ensureApp(uid, o);
        state.activity.push({ type: "save", text: `Saved to pipeline: ${o.title} at ${o.company}` });
        return { saved: true, application_id: app.id, stage: app.stage };
      }
      case "add_application": {
        const app = await h.putApp(uid, { ...input, deadline_source: "web, via Ask Bulldog", history_note: "Added by Ask Bulldog" });
        state.activity.push({ type: "save", text: `Added to pipeline: ${app.title} at ${app.company}` });
        return { added: true, application_id: app.id, stage: app.stage };
      }
      case "list_pipeline": {
        const apps = await h.appsWithBlockers(uid);
        return { applications: apps.map((a) => ({ id: a.id, title: a.title, company: a.company, stage: a.stage, deadline: a.deadline?.date || null, next_action: a.next_action, follow_up: a.follow_up, blockers: a.blockers })) };
      }
      case "get_my_profile": {
        const [p, claims] = await Promise.all([h.profileOf(uid), R.list(uid, "claim")]);
        return { name: p.name, school: p.school, majors: p.majors, year: p.year_label, preferences: p.preferences, confirmed_eligibility_facts: p.eligibility,
          confirmed_claims: claims.filter(h.usable).map((c) => ({ id: c.id, text: c.preferred_wording || c.text, title: c.title, org: c.org, dates: c.dates, status: c.status })),
          unreviewed_claims_count: claims.filter((c) => !h.usable(c)).length, voice_guide: p.voice?.guide || null };
      }
      case "find_contacts": {
        const q = clip(input.company, 120).toLowerCase();
        const cs = (await R.list(uid, "contact")).filter((c) => (c.company || "").toLowerCase().includes(q.split(" ")[0]));
        return { contacts: cs.slice(0, 20).map((c) => ({ id: c.id, name: c.name, role: c.role, company: c.company, relationship: c.relationship, email_status: c.email_status, profile_url: c.profile_url })) };
      }
      case "add_contact": {
        const c = await h.putContact(uid, { ...input, source: "ask_bulldog", verification: "unverified" });
        state.activity.push({ type: "contact", text: `Added contact (unverified): ${c.name}` });
        return { added: true, contact_id: c.id };
      }
      default: return { error: "Unknown tool" };
    }
  }

  // One user message → model calls and tool calls until the model answers.
  async function chat(uid, user, threadId, message) {
    const profile = await h.profileOf(uid);
    const model = ai.writingModel(profile.tier);
    const thread = (threadId && (await R.get(uid, "chat", threadId))) || { title: clip(message, 60), messages: [], display: [] };
    if (thread.messages.length >= MAX_THREAD_MESSAGES) throw Object.assign(new Error("This chat is long. Start a new chat to keep answers fast."), { status: 409 });
    await ai.bump(user, "chat");
    const claude = ai.client();
    const msgs = [...thread.messages, { role: "user", content: clip(message, 4000) }];
    const state = { activity: [], webSearches: 0 };
    const today = new Date().toISOString().slice(0, 10);
    let answer = "", usedModel = model;
    for (let step = 0; step < MAX_TURN_STEPS; step++) {
      const res = await claude.beta.messages.create({
        model, max_tokens: 8000, output_config: { effort: "low" },
        ...(/^claude-(fable-5-[12]|opus-5|sonnet-5-5)/.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
        system: `${SYSTEM}\n\nToday is ${today}.`, tools: TOOLS, messages: msgs,
      }, { timeout: 180000 });
      usedModel = res.model || model;
      msgs.push({ role: "assistant", content: res.content }); // append the full content, unchanged
      if (res.stop_reason === "refusal") { answer = "I can't help with that one. Try rephrasing it."; break; }
      const calls = res.content.filter((b) => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !calls.length) {
        answer = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        if (res.stop_reason === "max_tokens") answer += "\n\n(Answer cut short. Ask me to continue.)";
        break;
      }
      const results = [];
      for (const c of calls) {
        let out;
        try { out = await runTool(uid, user, c.name, c.input || {}, state); }
        catch (e) { out = { error: clip(e.message, 300) }; }
        results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out).slice(0, 20000), ...(out && out.error ? { is_error: true } : {}) });
      }
      msgs.push({ role: "user", content: results }); // all results for this step in one message
      if (step === MAX_TURN_STEPS - 1) answer = "I ran out of steps for this answer. Here's where I got to; ask me to keep going.";
    }
    thread.messages = msgs;
    thread.display = [...(thread.display || []), { role: "user", text: clip(message, 4000), at: new Date().toISOString() }, { role: "assistant", text: answer, activity: state.activity, model: usedModel, at: new Date().toISOString() }];
    const saved = await R.put(uid, "chat", thread);
    return { thread_id: saved.id, title: saved.title, reply: thread.display[thread.display.length - 1] };
  }

  return { chat };
};
