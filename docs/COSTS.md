# Costs: what's free, and what could ever cost money

The Boot Outreach workspace (`/workspace`) is built to run at **$0**. Nothing in it calls a paid service unless you add a key yourself.

## Free, on by default

| Piece | Why it's free |
|---|---|
| Job discovery | Public Greenhouse, Lever and Ashby job-board feeds. No key, no account, official employer postings. Cached 30 minutes per board to stay polite. |
| Ranking by meaning | A small local embedding model (all-MiniLM-L6-v2 via transformers.js) runs on your machine. It downloads once from Hugging Face (~23 MB) and needs no account or key. If it can't load, ranking falls back to keywords and says so. |
| Eligibility labels, evidence | Computed on your machine from the posting text. |
| Resume / cover letter / answer / outreach drafts | Assembled from your own claims ledger. No AI model. |
| LinkedIn connections | LinkedIn's own **Get a copy of your data** export (`Connections.csv`). Your own data, free, within LinkedIn's terms. |
| Calendar, CSV, JSON export | Generated locally. |
| Storage | `data/boot-db.json` on your machine (gitignored), or your existing Supabase project. |
| Hosting | `node server.js` on your laptop. |

## Things that could cost money, and what you'd need to do

None of these are turned on. Each needs an action from you first.

| Item | Cost today | What you'd do | Notes |
|---|---|---|---|
| **Anthropic API** (main chat app: opportunity deck, game plan, AI resume reading, tailoring, list research; Workspace ✨ AI rewrites) | Pay per use. Web-search features use Sonnet 5.5 ($2 / $10 per 1M tokens, roughly $0.10–0.30 per search-heavy call). Reading and writing use Haiku 5.5 ($0.10 / $0.50, roughly $0.001 per resume read or draft). Daily per-user limits apply (`DAILY_*_LIMIT`, `MONTHLY_CALL_CAP`). | Off unless you add `ANTHROPIC_API_KEY`. Without it these features are blocked with a clear message; no fake data. Onboarding still works: your resume's lines are saved to the Workspace without AI. The Workspace never uses it. | If you add a key, set a monthly spend limit in the Anthropic console first. |
| **Apollo.io** people search | Free plan exists (no time limit). The People API Search endpoint costs 0 credits but returns no emails. Enrichment (emails) costs credits. | Sign up yourself with a work email, create an API key, put it in `.env` as `APOLLO_API_KEY`. The app only calls the 0-credit search endpoint. | Apollo's terms: internal use only, no reselling, no use "with LinkedIn automations". Results are labeled unverified. |
| **Hunter.io** (email finder) | Free plan: 50 credits/month | Not integrated. If you want it, sign up and we'd add it the same way as Apollo. | 1 credit per email found. |
| **People Data Labs** | Free: 100 credits/month, but contact data is hidden on free | Not integrated; not useful for free. | |
| **Composio** (LinkedIn connect, added earlier) | Has a free tier; check limits before use | Add `COMPOSIO_API_KEY` + auth config id only if you want it. | Official LinkedIn API only gives name/email/photo. |
| **Linq** (iMessage/SMS alerts, PRD §8.6) | Paid partner API; needs provisioning and commercial terms | Not built. You'd need a Linq account, a provisioned number and API credentials. | Fallback in use: calendar `.ics` + in-app queue. |
| **Supabase** | Free tier | Only if you deploy the Yale beta. Run the new `boot_records` block in `supabase/schema.sql`. | Free tier pauses idle projects. |
| **Render** hosting | Free plan | Only to deploy. | Free instances sleep when idle. |
| **Unipile / cookie-based LinkedIn tools** | Paid per account | Not recommended (breaks LinkedIn's terms, risks your account). | Not built. |

## Rule of thumb

If a feature asks for an API key, it's optional and off until you add one. Without any keys, everything in the workspace works.
