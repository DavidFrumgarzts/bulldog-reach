# Yale opportunity sources: what we can actually use

Checked live on Nov 17, 2026. Nothing was logged into or submitted.

| Source | Access | Feed / API | Verdict |
|---|---|---|---|
| **OCS site posts** (ocs.yale.edu) | Public | RSS: `https://ocs.yale.edu/feed/`, per channel e.g. `/channels/career/feed/` | **Ingest now.** Deadlines are in the post text, not a separate field |
| **OCS events + Yale Career Link** (Symplicity, `yale-csm.symplicity.com`) | NetID login | none public | **Link out only.** Needs an OCS partnership |
| **Fellowships / Student Grants DB** (funding.yale.edu → `yale.communityforce.com`) | Search page public; results via form postback | No public detail URLs | **Needs Yale permission.** Ask studentgrants@yale.edu for an export |
| **Study Abroad (OISP)**: `studyabroad.yale.edu/get-started/search-programs` | Public, 273 programs | HTML (Drupal), Crawl-delay 10 | **Ingest now** with a polite scrape. Deadlines are on separate pages; applications go through COMPASS (NetID) |
| **Yale events (Localist)**: `events.yale.edu/api/2/events` | Public JSON + iCal | `/api/2/events?days=30&pp=100`, `/calendar/1.ics` | **Technically open, but robots.txt says `Disallow: /`.** Email the calendar admins before running a crawler. The career topic is sparse |
| **Science & QR research funding** (science.yalecollege.yale.edu) | Public | static pages | **Ingest now**, by hand or a light scrape. Few programs, clear deadlines (STARS II Jan 4, STARS Summer Feb 5, Tetelman Feb 11, Dean's Research Fellowship Feb 18, First-Year Summer Research Mar 3, 2027) |
| **y/labs** (yalelabs.io, run by YURA) | Says it's NetID-only; couldn't confirm | JS app | **Partner with YURA** (student-run, so easy to approach) |
| **"Opal"** | Not found | n/a | **Unknown.** Need the URL from whoever suggested it |
| **Yale CAS (NetID login)** | Allowed for non-yale.edu apps **after registration** | `secure.its.yale.edu/cas/login` | File the ITS CAS registration (ServiceNow form, about 5 business days). Until then the beta uses a @yale.edu email magic link |

## Next steps for sources

1. Add an OCS RSS ingester, plus a hand-curated Science & QR fellowship list with deadlines.
2. Add a Study Abroad scraper that respects Crawl-delay 10.
3. Email the Localist admins, OCS, the Student Grants office, and YURA about data access.
4. File the CAS registration.
