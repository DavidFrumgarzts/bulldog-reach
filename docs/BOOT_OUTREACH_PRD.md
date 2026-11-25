# Boot Outreach: Product Requirements Document

**Status:** Draft for implementation planning  
**Repository reviewed:** `DavidFrumgarzts/bulldog-reach`  
**Repository snapshot:** `main` at `785405147e8a95e45d8f5f22a314472a6f4448c7`  
**Prepared:** 24 November 2026

## 1. Product summary

Boot Outreach should help a student go from “I want a strong internship in AI, robotics, or tech” to a verified shortlist, tailored application materials, thoughtful outreach, and a tracked application. The user should spend their time making choices and reviewing high-impact details, rather than repeating research and rewriting the same information across dozens of job portals.

The product should find real opportunities, explain why each fits, collect evidence for key claims, prepare role-specific application materials from the user’s verified experience, and keep every application and contact organized. Over time, it can use Linq for mobile alerts and approved messages, and assist with filling application forms. It must preserve a human review step before any application is submitted or any external message is sent.

The current repository, named **Bulldog Reach**, already prototypes the initial discovery, save, planning, and resume-tailoring loop. This PRD describes the next product evolution for **Boot Outreach**. Whether the repo should be renamed is an implementation and branding decision, not a requirement of this spec.

## 2. Product vision and user outcome

**Vision:** A personal, evidence-backed job-search operator that makes a high-quality internship search feel like a clear, manageable pipeline.

**Primary outcome:** A user can find an appropriate role, confirm it is live and that its constraints are understood, prepare an honest and targeted application, plan relevant outreach, and submit it with deliberate approval, all from one workspace.

**Initial launch user:** Alwis, a Singaporean Yale undergraduate pursuing U.S. internships, especially in New York and the San Francisco Bay Area, across AI, robotics, product, go-to-market, technical program management, customer and partner solutions, and startup operations. The system should also be configurable for other users and locations rather than permanently hardcoding this profile.

### User profile and preferences this product should support

- Yale undergraduate studying Computer Science and Global Affairs; expected graduation May 2029.
- Singaporean student in the U.S. on F-1 status. Work authorization, CPT, location, and internship dates are high-impact constraints that must be represented as explicit user-confirmed facts, never inferred by the system.
- Interested in robotics and AI as a path toward eventually founding a startup. Values startup execution, product and customer exposure, go-to-market learning, operational ownership, and credibility from working with strong teams.
- Especially interested in roles at the intersection of product, GTM, customer discovery, deployment, technical operations, partnerships, and software. Also open to technical roles when the requirements are realistic and the role offers useful learning.
- Relevant experience includes Axis/Codeezy co-founding and customer discovery; YouthTechSG 0-to-1 community and program building, Deputy CEO (formerly Chief of Staff to CEO); Canberra Youth Network vice-chairmanship; Changi Airport Group operational analytics and a live 3D LiDAR trial; GovTech cybersecurity tooling; Singapore Polytechnic cybersecurity and digital forensics; and Yale robotics research experience.
- User has repeatedly corrected inaccurate resume wording and unsupported numbers. Claims must remain traceable to user-provided facts or documents, and user preferences about exact titles, dates, phrasing, and what to omit should persist.

## 3. Repository review: what exists now

This review is based on the public repository’s README, current PRD, source documentation, server, frontend modules, storage module, calendar helper, and Supabase schema. Repository links: [repository](https://github.com/DavidFrumgarzts/bulldog-reach), [README](https://github.com/DavidFrumgarzts/bulldog-reach/blob/main/README.md), [current PRD](https://github.com/DavidFrumgarzts/bulldog-reach/blob/main/docs/PRD.md), [source notes](https://github.com/DavidFrumgarzts/bulldog-reach/blob/main/docs/SOURCES.md).

### Implemented product surface

| Area | Existing behavior | Limitation to address |
|---|---|---|
| Onboarding | Yale-oriented onboarding; can accept a LinkedIn PDF, resume PDF/DOCX/TXT, interests, class year, opportunity types, location, goals, and people to contact. | Too tied to a Yale-only beta identity; work authorization, date availability, location mode, compensation, and role constraints are not a structured, reviewable profile. |
| Opportunity discovery | Chat-style search using Anthropic Messages and web search. Results are generated as opportunity cards, can be swiped to save, and the user can request more options. | Search is not a durable, source-grounded job feed. Search results may not be active, current, or complete. Seen-title avoidance is not reliable deduplication. |
| Opportunity records | Stores title, organization, type, location, domain, deadline text, URL, pitch, Yale tie, and fit. | No complete source record, source freshness, field-level provenance, active-status check, structured eligibility, salary, sponsorship, CPT, modality, or confidence model. |
| Save and planning | Saved roles can be enriched with summary, eligibility, contacts, deadlines/events, checklist, next actions, and suggested messages. | Enrichment can still be uncertain; evidence is not linked to each claim. Contact data and fit explanations need review and source quality labels. |
| Pipeline | Tracks saved, applying, submitted, interview, offer, and dropped; supports checklist progress, urgency ranking, outreach recipients, and simple contact states. | No unified application record with submitted files, questions, answers, confirmations, and a durable activity history. |
| Calendar | Generates an ICS calendar feed and downloadable events for deadlines and relevant events. | Dates need source, confidence, and verification rules before they become reminders. |
| Resume work | Parses common resume formats, stores an editable base resume, proposes role-specific edits, lets the user accept/reject edits, flags new wording and placeholders, and exports PDF/DOCX. | No evidence ledger for resume claims, version history by role, cover letter and application-answer workspace, or final application package preview. |
| Persistence | Supabase-backed profile and saved plans, with local/demo behavior and email magic-link access. | Sensitive profile and resume data need explicit retention, export/delete, privacy controls, and clearer account states. |
| Messaging | Generates outreach text and supports copying it; tracks whether a contact is to-do, sent, replied, meeting, referred, or no reply. | No native sending, no approval record, no channel preference management, and no Linq integration. |
| Application submission | Not implemented. | No structured form capture, answer library, browser-assisted fill, final packet review, or submission receipt. |

The current app is a useful prototype of the user’s search-and-organize flow. It is not yet a dependable job database, a complete application workspace, or an application-submission agent.

## 4. Problem statement

The user’s search spans companies, job boards, and locations. Each opportunity requires repeated work: checking whether the role is still open; understanding requirements and visa constraints; assessing fit; tailoring a resume; drafting answers and outreach; tracking contacts and deadlines; and recording the application outcome. Search engines and general chat can help with individual steps, but they leave the user to reconnect the evidence and state across steps.

The product must solve four related problems:

1. **Trust:** Search results need to be real, current, attributable, and explicit about unknowns.
2. **Fit:** A match needs to consider both the user’s qualifications and hard constraints, including location, schedule, graduation, and work authorization.
3. **Execution:** A promising role must turn into a prepared, complete application with reusable but reviewable materials.
4. **Continuity:** Research, outreach, deadlines, and outcomes need to remain together as the user works across multiple roles and devices.

## 5. Goals and non-goals

### Goals

- Find relevant internships and early-career roles, prioritizing U.S. roles initially and allowing other regions through user preferences.
- Prefer official company career pages and official ATS postings, with source attribution and a last-checked date.
- Clearly distinguish role fit from eligibility and work-authorization feasibility.
- Let the user tune and save a profile of role interests, location, dates, availability, compensation expectations, and constraints.
- Maintain a verified experience and claims library that can generate accurate resumes, cover letters, and application answers.
- Track each application, its materials, outreach, deadlines, status, and follow-up actions in one place.
- Make user approval explicit before external messages or a job application is submitted.
- Support mobile workflows through Linq, starting with concise alerts and approval links.
- Make the product useful for repeat searches rather than one-off chat sessions.

### Non-goals for the first release

- Guaranteeing interviews, employment, sponsorship, or legal eligibility.
- Automatically applying to every matching job or making the user’s final eligibility attestations.
- Sending mass outreach or scraping LinkedIn behind access controls.
- Replacing Yale’s Career Link, an employer ATS, or immigration counsel / the school’s Designated School Official.
- Supporting every country’s job boards and work authorization regimes at launch.
- Taking actions that bypass authentication, CAPTCHAs, rate limits, or a site’s access terms.

## 6. Product principles

1. **Evidence before confidence.** Every consequential claim should be linked to where it came from and when it was checked.
2. **Separate fit from eligibility.** “This matches your interests” must not be presented as “you can legally work here” or “you meet every requirement.”
3. **Use confirmed facts.** Never invent experience, metrics, language ability, skills, availability, or work authorization.
4. **Keep the user in control.** Review and approval are required before submission or outbound communication.
5. **Show uncertainty plainly.** Use “unknown” or “needs confirmation” instead of guessing.
6. **Reduce repetitive work without hiding changes.** Show diffs and reusable answers, and make it easy to edit them.
7. **Capture the user’s corrections.** When a user fixes a title, date, metric, or preferred wording, update their profile truth record and use it consistently.

## 7. Priority user journeys

### Journey A: Find and qualify roles

1. The user selects a saved search or enters a request in natural language, such as “NYC or Bay Area AI/robotics internships for Summer 2027, with product, GTM, TPM, customer solutions, or operations responsibilities.”
2. Boot Outreach searches configured sources and deduplicates roles by employer and canonical posting URL.
3. Each result shows role fit, eligibility status, why it matches, missing facts, and source evidence.
4. The user filters, saves, dismisses, or asks to refresh. A dismissed result remains excluded until the user changes that preference.
5. Saved roles move into a qualified shortlist and a next-action queue.

### Journey B: Prepare a truthful application

1. The user opens a saved role and reviews the complete posting and constraints.
2. Boot Outreach creates an application workspace from the confirmed profile and role requirements.
3. The user chooses a resume base and receives an edited version with a claim-by-claim source, change diff, and any unsupported or uncertain facts clearly marked.
4. Boot Outreach drafts a cover letter and answers to the employer’s questions, reusing approved profile facts and prior answers where appropriate.
5. The user edits and approves each artifact. The final packet contains the exact resume, cover letter, answers, and unresolved questions.

### Journey C: Outreach and follow-up

1. Boot Outreach finds relevant people using accessible, attributable sources or lets the user add a person manually.
2. Each contact record distinguishes verified information from an inferred email or unverified profile match.
3. Boot Outreach drafts a short, role-specific connection request or email, with the reason for contact and relevant shared context.
4. The user copies the draft or approves a supported send action. Contact status and follow-up date are recorded.
5. Replies and meetings are captured manually at first; future Linq workflows can surface notifications and let the user update status by replying.

### Journey D: Submit with approval

1. Boot Outreach prepares a final packet and, where feasible and permitted, helps fill an employer form in the user’s active browser session.
2. The user reviews each answer, resume, cover letter, required disclosure, and any legal/work-authorization attestation.
3. The user sees a final confirmation screen with employer, role, destination, attached documents, and exact answers.
4. Only an explicit per-application approval permits the final submission action. If the site requires a CAPTCHA, authentication step, or human attestation, the user completes it directly.
5. Boot Outreach records the result and retains the confirmation/receipt when available.

## 8. Functional requirements

Priority labels: **P0** required for a dependable first release; **P1** important next; **P2** later expansion.

### 8.1 Profile, preferences, and truth ledger – P0

- Store editable preferences for role families, industries, locations, work arrangement, internship term and dates, days per week, compensation range, company stage, and desired learning outcomes.
- Store structured eligibility facts only when confirmed by the user: citizenship/work authorization, F-1 status, CPT/OPT status, school, academic term, and any restrictions they choose to provide.
- Include a “confirmed on” date and optional evidence/reference for high-impact facts.
- Maintain a claims library for education, roles, dates, projects, skills, metrics, language, and user-approved descriptions. Each claim has source, confirmation status, and preferred wording.
- Allow users to mark a claim as verified, approximate, omit, or needs evidence. Approximate metrics must not appear as exact numbers without approval.
- Preserve user corrections and exact exclusions across future generated materials.
- Permit user data export and deletion. Do not require LinkedIn credentials or scrape private LinkedIn data.

**Acceptance criteria:** A user can update a title, date, or metric once and see that correction reflected in new application drafts. Generated materials cannot silently promote a claim from approximate or unverified to verified.

### 8.2 Opportunity discovery and evidence – P0

- Support saved searches with natural-language instructions and explicit structured filters.
- Search official career pages and supported public ATS feeds first. Add other sources only where access is permitted and the source can be attributed.
- Normalize results to one opportunity per canonical posting URL, with company, title, location, department, type, posting URL, source, and last checked time.
- Capture field-level evidence for application deadline, term, compensation, work mode, required qualifications, language, sponsorship, and work authorization whenever published.
- Show an evidence link and checked date beside every important fact. Mark unreported information as “not stated.”
- Refresh a saved role’s original page before recommending application; mark it “open,” “closed,” “unclear,” or “not checked” based on evidence.
- Show separate scores or labels for: role-interest fit, experience fit, and eligibility/work-authorization status. Explain each in plain language and expose missing information.
- Allow the user to tune ranking priorities, such as startup learning, product/GTM exposure, robotics relevance, brand/credibility, compensation, or location.
- Deduplicate across sources and retain the employer’s canonical application URL.
- Make search results reproducible: preserve query, source, timestamp, and the evidence used for the result.

**Acceptance criteria:** Every saved role has a canonical source URL and last-checked time. A role with unknown visa policy is shown as unknown, never as sponsorship available or unavailable. Expired or unverifiable deadlines are not silently put on the calendar as firm dates.

### 8.3 Application pipeline – P0

- Add stages: discovered, researching, shortlisted, preparing, ready for review, submitted, assessment, interview, offer, rejected, withdrawn, and archived.
- Record stage changes and activity history with timestamps.
- Track deadline, next action, follow-up date, expected schedule, job contact, and user notes.
- Make a dashboard for saved roles, priority, missing information, and next action.
- Allow bulk triage and saved views, but do not bulk-submit or bulk-send messages.
- Support export to CSV and calendar reminders.

**Acceptance criteria:** A user can see all open application work in a single queue and identify what blocks each application from becoming ready.

### 8.4 Application workspace and material generation – P0

- Create a per-role workspace containing the original posting, extracted requirements, source evidence, resume version, cover letter, short-answer drafts, outreach, and status.
- Parse and store the application’s actual questions when supplied by the user or obtained from a permitted page/form.
- Generate a response from approved facts and prior approved answers. Show which profile claims support each proposed answer.
- Keep an answer library with context tags and a “reconfirm before reuse” option for time-sensitive answers.
- Generate role-specific resumes and cover letters as editable documents with version history and PDF/DOCX export.
- Present a before-and-after diff. Flag unsupported claims, unclear facts, placeholders, mismatches with the posting, and inconsistent dates/titles.
- Never add a skill or accomplishment solely because it appears in the job description.
- Make the final application packet previewable and downloadable.

**Acceptance criteria:** A generated document is traceable to the selected source resume and approved profile facts. An unsupported claim is flagged and cannot be treated as approved until the user explicitly approves or edits it.

### 8.5 Outreach CRM – P1

- Store person, company, role/relationship, profile URL, contact channel, source URL, verification status, last interaction, follow-up date, and notes.
- Label email data as verified, user-provided, or inferred/unverified. Do not present guessed contact details as confirmed.
- Generate concise, context-specific email, LinkedIn connection, and follow-up drafts using approved background facts.
- Support copy, open-in-channel, and explicitly approved sends through an available supported integration.
- Record the exact approved text, channel, time, send status, and response status.
- Respect channel rules, user preferences, and opt-out. Avoid automated bulk outreach.

### 8.6 Linq mobile companion – P1, subject to provider access

Linq provides a partner API for programmatic iMessage, RCS, and SMS workflows, including inbound/outbound messaging and webhooks, subject to Linq provisioning and access. This is a third-party messaging provider, not a direct interface to send from the user’s personal Apple Messages number. See [Linq iMessage API documentation](https://docs.linqapp.com/channel/imessage/) and [Linq API overview](https://linqapp.com/imessage-api).

- Begin with alerts and secure links: new high-fit role, deadline approaching, application packet ready for review, and outreach follow-up due.
- Keep messages short and avoid sending resume text, passport details, or other sensitive data in message bodies.
- Use a signed, expiring deep link to open the relevant item in Boot Outreach.
- Require an explicit in-app review and approval before any external message or application action. A reply such as “approve” may open the review flow but must not bypass the final review.
- Add two-way actions only after webhooks, delivery states, identity, consent, and Linq account provisioning are implemented.
- Provide notification preferences, quiet hours, frequency limits, unsubscribe/disable controls, and a log of messages sent and received.
- Treat Linq account, number provisioning, commercial terms, and API credentials as launch dependencies. If unavailable, keep the web app and use email/calendar notifications as a fallback.

**Acceptance criteria:** A Linq alert can notify the user about an application or deadline and open the correct secure workspace. It cannot submit an application or send outreach merely because a notification was delivered or opened.

### 8.7 Browser-assisted application completion – P2

- Start with an opt-in browser companion or user-controlled browser session that detects an application form and maps known fields to saved, approved profile facts.
- Show every proposed field value before filling it. Let the user edit or skip each value.
- Highlight legal attestations, demographic questions, work-authorization answers, and other sensitive declarations for direct user review.
- Do not bypass authentication, CAPTCHA, bot protections, rate limits, or site terms. If an interaction is blocked or uncertain, hand control to the user.
- Submission must be per-role, after the complete packet preview and a clear final approval action. Where the employer expects a human-only attestation or the site does not permit automation, the user submits directly.
- Record the final destination, user approval, completion timestamp, status, and any available receipt.

**Acceptance criteria:** No browser automation can submit without a final explicit user approval after a complete, visible review. A blocked or ambiguous form leaves the application in “ready for user” state rather than guessing.

### 8.8 Reliability, privacy, and security – P0

- Keep secrets server-side; use least-privilege tokens and rotateable credentials.
- Protect resume/profile data in transit and at rest. Restrict access per user and test authorization boundaries before broad release.
- Let the user see, export, and delete profile, resumes, application data, and message history.
- Define data retention for uploads, extracted text, generated files, logs, and backups.
- Record model/source version, prompt version, and retrieval evidence for key generated recommendations.
- Rate-limit source access and API use. Handle timeouts, duplicate records, and stale results gracefully.
- Clearly label model-generated summaries and recommendations. Do not imply official endorsement by Yale, an employer, or an accelerator.
- Provide accessible keyboard navigation and mobile layouts for core search, review, and pipeline actions.

## 9. Linq integration plan

### Phase L0: prove access and establish boundaries

- Confirm developer/partner access, number provisioning, supported message types, webhook security, expected costs, and regional availability.
- Create a dev environment and test only with the user’s own test number and test application data.
- Define opt-in, quiet hours, notification frequency, stop behavior, and a clear distinction between alert, draft, and sent message.

### Phase L1: outbound notifications

- Send a concise notification for a high-priority role, imminent deadline, or packet ready for review.
- Include employer, role, reason for alert, and a signed link to the app. No sensitive application answers or resume contents in the message.
- Log message ID, delivery state, send time, preference state, and associated application.

### Phase L2: inbound quick actions

- Accept a small command set such as `list`, `snooze`, `remind me tomorrow`, or `open [role]`.
- Treat “approve” as a request to open a final review, never as sufficient approval for submission or outbound outreach.
- Verify webhook signatures, prevent replay, and require an authenticated account-to-number mapping.

### Phase L3: conversation and workflow controls

- Let the user ask for a shortlist summary or update a task through the bot, with confirmation for consequential changes.
- Preserve an auditable message log and support revocation/deletion.
- Only add recruiter or founder messaging when the user explicitly selects a recipient and approves exact content.

## 10. Proposed data model additions

These are conceptual entities; retain the current stack where sensible and evolve after validating the first release.

- `UserProfile`: preferences, dates, location, role families, confirmed eligibility facts, and notification settings.
- `ProfileClaim`: structured claim, preferred wording, source, verification state, last confirmed date, tags, and exclusions.
- `SavedSearch`: natural language query, filters, region, source scope, cadence, and exclusions.
- `Opportunity`: normalized employer, title, canonical URL, ATS/source IDs, status, locations, role attributes, and timestamps.
- `OpportunityEvidence`: field, extracted value, source URL, quoted/context excerpt, checked time, method, and confidence.
- `FitAssessment`: separate interest fit, experience fit, eligibility state, reasoning, missing information, and profile version.
- `Application`: opportunity, status, deadline, next action, contact, owner, and stage history.
- `ApplicationArtifact`: artifact type, source version, file/object location, generated content, diff, approval state, and version.
- `ApplicationQuestion` and `ApplicationAnswer`: source/form context, answer, supporting claims, approval, and reuse policy.
- `Contact` and `OutreachActivity`: person, source, channel, verification state, exact message, approval record, response, and follow-up.
- `Notification` and `ProviderMessage`: channel, user preference, Linq message ID, delivery/webhook state, expiration, and linked application.
- `SubmissionRecord`: final packet hash/version, destination, final approval timestamp, result, and confirmation/receipt reference.

## 11. Rollout plan

### Release 1: trustworthy shortlist and profile

- Structured editable profile and confirmed-facts ledger.
- Source-attributed discovery and canonical deduplication.
- Role state and separate fit/eligibility checks.
- Refresh/check-open flow, saved searches, and an application queue.
- Evidence-backed opportunity details and reliable date handling.

### Release 2: complete application workspace

- Per-role materials and question workspace.
- Resume/cover letter versioning and evidence-backed diffs.
- Answer library and packet preview.
- Outreach/contact CRM and follow-up reminders.
- CSV and calendar export.

### Release 3: mobile notifications with Linq

- Validate provider access and provisioned number.
- Secure, opt-in application/deadline notifications.
- Signed links to review pages and notification preference controls.
- Limited inbound workflow actions after webhook security review.

### Release 4: assisted form completion

- User-controlled browser support for compatible, permitted forms.
- Field-by-field preview and editable mappings.
- Final approval and submission receipt tracking.
- Expand sources and regions only after reliability and support costs are understood.

## 12. Success measures

### Trust and data quality

- Share of active opportunity cards with a canonical URL and last-checked timestamp.
- Share of deadline, compensation, location, eligibility, and visa-policy claims with direct evidence or an explicit “not stated/unknown” label.
- Rate of duplicate, expired, or materially incorrect saved postings reported by the user.
- Rate of fabricated or unsupported claims in generated materials; target is zero unapproved claims in exported final artifacts.

### User execution

- Time from discovering a role to a complete, reviewed application packet.
- Share of saved opportunities that reach a deliberate outcome: applied, dismissed, or archived with reason.
- Follow-up completion rate and missed-deadline rate.
- User-rated relevance of shortlist and usefulness of fit explanation.

### Approval and messaging

- Every submitted application has a recorded final per-application approval.
- Every outbound message has a recorded user approval or was explicitly sent by the user outside Boot Outreach.
- Linq delivery and action success rate, opt-out rate, and accidental/duplicate notification rate.

## 13. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Search-generated postings may be stale, duplicated, or fictional. | Use official sources first, verify original pages, store provenance and checked timestamps, and show unknowns. |
| Visa or eligibility statements can be costly if wrong. | Separate fit from eligibility, quote employer language, avoid legal conclusions, and direct unresolved questions to the employer or Yale DSO. |
| Generated application content may exaggerate the user’s record. | Use confirmed claim library, source every claim, show diffs, and require user approval. |
| Automation may conflict with ATS or site rules. | Use user-controlled browser flows, honor access limits, and hand off when blocked or uncertain. |
| Personal data and immigration details are sensitive. | Minimize collection, encrypt, restrict access, set retention, and provide export/delete controls. |
| Linq access or provisioning may not be available. | Validate early; ship the core product without Linq and use web/email/calendar notifications. |
| Overly broad regional coverage makes the product unreliable. | Launch with the user’s U.S. focus, keep region configurable, and expand after source quality is measured. |

## 14. Decisions to validate during implementation

These are product decisions to resolve from repository structure and user workflow, not blockers to the PRD:

1. Whether “Boot Outreach” becomes the application name or remains a project name while the product is still branded Bulldog Reach.
2. Whether the first source integrations are Greenhouse, Lever, and Ashby public boards, plus targeted official company career pages.
3. Whether the first deployment remains single-user/private or supports multiple users from the outset.
4. Which Linq account type, number provisioning, webhook, and commercial prerequisites are available.
5. Whether application form assistance should begin as a browser extension, an in-app browser, or an exportable answer pack. Start with the lowest-risk user-controlled version.

## 15. Repository files reviewed

- `README.md`
- `docs/PRD.md`
- `docs/SOURCES.md`
- `package.json`
- `.env.example`
- `server.js`
- `public/app.html`
- `public/app.js`
- `public/core.js`
- `public/cart.js`
- `public/resume.js`
- `lib/store.js`
- `lib/ics.js`
- `supabase/schema.sql`

This PRD is a product-planning artifact, not a claim that all requirements are implemented. It does not modify or commit changes to the GitHub repository.
