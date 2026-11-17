# PRD: Yale Opportunity Aggregator (Bulldog Reach)

> Source: team PRD and whiteboard notes, Nov 17, 2026. The working name "Yale Summer" was suggested, and the final name isn't settled. The repo and app are currently called **Bulldog Reach**.

## Product goal

Bring career, research, fellowship, study-abroad, and summer opportunities for Yale students into one place. Students should be able to find opportunities, save the ones they care about, see deadlines and events on Google Calendar, and work through each application step by step.

## Core user flow

1. **Search or browse** opportunities pulled together from the available sources.
2. **Save** opportunities to an interest list (the team also called this a "shopping cart").
3. **See saved opportunities ordered by deadline.**
4. **Add dates to Google Calendar.** This covers application deadlines, and also info sessions, office hours, research events, networking events, and coffee chats.
5. **Open an opportunity** to see an application checklist, suggested next actions, and draft messages. Students mark steps done as they complete them.

## Feature areas

1. **Source discovery and aggregation.** Find opportunities across the supported platforms and show their details in one consistent format.
2. **Opportunity interface and calendar flow.** Show opportunities, let students save the ones they want, and add the related deadlines and events to Google Calendar.
3. **Application assistance.** For each opportunity, generate a checklist, suggested next actions, and suggested messages. Students can track what they've finished.
4. **Resume tailoring (proposed, scope later).** Students upload a base resume and connect LinkedIn, and the app suggests keywords and tailoring for each job.

## Sources to explore

- Yale students, alumni, and professors (people to reach out to), and their programs
- Yale Office of Career Strategy (OCS) and Yale Career Link
- Yale fellowships, and study abroad
- Other opportunity platforms mentioned in discussion, including "Opal"

**Rule:** before building ingestion for a source, confirm what can actually be accessed or connected.

## Whiteboard notes (transcribed)

1. Goal
2. The platform finds:
   - Yale students, alumni, and professors
   - Programs as well
   - A Yale OCS Career Link connection
   - Yale fellowships and study abroad
3. Gathers deadlines and puts them into Google Calendar
4. The platform searches for opportunities automatically and lists them by deadline
5. Open an opportunity → actions and suggested messages show
   - A checklist for it
   - Message generation
   - Resume tailoring for each job
- Design
- Info sessions and office hours (OH) as well

## Implementation notes

- The team works together in one GitHub repo rather than splitting features between people.
- Supabase deployment is in progress.
- A login that accepts only Yale IDs was proposed but isn't confirmed feasible. The current beta uses an **email magic link restricted to @yale.edu addresses**. Real Yale NetID/CAS single sign-on needs Yale ITS approval (see the source research).
