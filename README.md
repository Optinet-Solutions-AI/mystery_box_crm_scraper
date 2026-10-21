# CRM Intel: competitor email intelligence

You sign up to competitor brands (mystery box and card-rip operators to start: Crown Rips, Packz, Courtyard) with a research Gmail account. The app then reads that inbox read-only, keeps only emails from the brands you track, and runs each one through OpenAI. The AI classifies the email, extracts its offers, analyzes the marketing, and groups related emails into campaigns. The results feed a dashboard, a competitor comparison, a marketing calendar, lifecycle journeys and an AI analyst you can ask questions.

**Stack:** Next.js 16 (App Router), Tailwind CSS 4, pnpm, Supabase (Postgres), Gmail API (read-only), OpenAI API.

## How it works

1. **Brands → Add brand** (`brandname.com`) → **Open signup window**. The brand's signup page opens in a popup, where you sign up with Google. Signup pages and Google sign-in refuse to load inside an iframe, so the app uses a popup instead. Then click **I've signed up**. That time becomes day 0 for lifecycle tracking.
2. **Settings → Research mailboxes:** add one or more Gmail accounts and connect each one with Google, read-only. The first sync backfills the last 90 days (configurable) of mail from tracked brands. After that, sync is incremental through the Gmail history API, with Pub/Sub push as an option.
3. Each email is parsed (sender, reply-to, recipient, subject, preheader, timestamps, HTML/text, CTAs, images, promo codes, unsubscribe link, Gmail IDs). It is deduplicated, matched to a brand and test account, and analyzed:
   - **Email type:** promotional vs transactional, security, verification code, support. Non-promotional mail is kept as lifecycle events but never counted in campaign metrics.
   - **Categories:** 16 categories plus industry-specific ones. You can correct them by hand.
   - **Offers:** stored as structured database fields (value, currency, minimum, cap, code, eligibility, dates, conditions, CTA, confidence, verbatim evidence). Anything the email doesn't state stays empty and shows as "Not stated".
   - **Marketing analysis:** tone, urgency, personalization, emoji, social proof, creative format, hero, partnerships, seasonal events.
   - **Campaign grouping:** by subject, theme, offer, promo code, landing page and timing, with launch / follow-up / repeat / variation roles. Campaigns stay labelled **inferred** until a person confirms them.
4. The dashboards read the structured tables. The AI analyst answers questions by querying those tables with tools, and links every claim to the email or campaign behind it.

Personal mail is never stored. The incremental sync reads headers first and only downloads emails that could belong to a tracked brand.

## Pages

| Page | What it shows |
|---|---|
| Dashboard `/` | 8 KPI cards, activity timeline, volume chart, top offers, intelligence feed, share of inbox-observed emails, AI findings |
| Compare `/compare` | 2–10 brands side by side, a 0–100 scorecard with documented formulas and adjustable weights, benchmark answers |
| Calendar `/calendar` | Month/week/day views of campaigns. Toggle between email send dates and advertised promotion dates. Overlaps, repeats, gaps, expiries |
| Lifecycle `/lifecycle` | Journey from signup per test account (first 24h, days 1–7, days 8–30), and aligned journey comparison across brands |
| AI Analyst `/analyst` | Questions in plain language, answered with numbers, evidence links, changes vs the previous period, and recommendations |
| Feed & alerts `/feed` | New campaigns, new incentive types, volume changes, expiring offers. Alert rules can post to a Slack or other webhook |
| Emails / Campaigns / Offers / Brands / Settings | The underlying data, a safe email preview, corrections, sync controls |

## Setup

### 1. Install

```bash
pnpm install
cp .env.example .env.local
```

### 2. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run the schema. Either paste `supabase/migrations/20261021000000_init.sql` into **SQL Editor → New query → Run**, or use the CLI: `pnpm exec supabase link --project-ref <ref>` and then `pnpm exec supabase db push`.
   The schema creates every table, seeds the industry templates (mystery box, iGaming, e-commerce, fintech, travel, subscription) and adds the first three brands.
3. Copy **Project URL** and the **service_role** key (Project Settings → API) into `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
   Every table has row-level security turned on with no policies, so only the server can read data. The browser never talks to Supabase.

### 3. Google (Gmail read-only)

OAuth clients and mailboxes are managed in the app (**Settings**), so you can use as many research Gmail accounts as you need. You don't need env vars for them.

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Gmail API**.
2. Set up the **OAuth consent screen**: External, and add the scope `.../auth/gmail.readonly`.
   - **Important:** set the publishing status to **In production**. In "Testing" status, Google expires refresh tokens after 7 days and the mailbox disconnects every week. An unverified app shows a warning screen during sign-in. Click through it; that's fine for an internal tool with a few users.
3. Under **Credentials → Create OAuth client ID → Web application**, add an authorized redirect URI for each place the app runs:
   - `http://localhost:3000/api/gmail/callback`
   - `https://<your-vercel-domain>/api/gmail/callback`

   The Settings page shows the exact redirect URI for the current URL.
4. In the app, go to **Settings → Google OAuth clients → Add** and paste the client ID and secret. They're stored encrypted with `ENCRYPTION_KEY`.
5. Go to **Settings → Research mailboxes → Add mailbox**, enter the Gmail address, pick the OAuth client, then click **Connect with Google** and sign in as that address.

Add as many mailboxes as you like, for example one per persona. Each mailbox can be edited, paused, reconnected, re-synced or deleted. Deleting a mailbox keeps the emails already collected from it. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` env vars still work as a fallback client.

### 4. OpenAI

Set `OPENAI_API_KEY`. Without it the app still ingests emails, but it falls back to simple keyword rules: no offer extraction, no AI analyst.

- **Model:** the default is `gpt-6.1-sol`; override it with `OPENAI_MODEL`, e.g. `gpt-6-luna` for lower cost or `gpt-6-astra` for maximum quality.
- **Structured outputs:** every email analysis uses a strict JSON schema, so results always land in the database fields.
- **Images:** the 3 largest content images of each email are sent along so offers that only appear in images still get read. Set `ANALYZE_IMAGES=false` to turn this off.

### 5. Run

```bash
pnpm dev
```

Open http://localhost:3000, then:

1. **Settings:** add the Google OAuth client, add the mailbox (e.g. christian.fletcher.rxpress@gmail.com), then click **Connect with Google**.
2. **Brands →** sign up to each brand and confirm the signup.

Set `APP_PASSWORD` and `SESSION_SECRET` to put the app behind a team password.

## Deploying (Vercel)

1. Import the repo into Vercel and add all variables from `.env.example`. Set `APP_URL` to the production URL; a `localhost` value is ignored on Vercel. Add `https://<your-vercel-domain>/api/gmail/callback` as a redirect URI on the Google OAuth client.
2. **Scheduled sync:** `GET /api/cron/sync` with `Authorization: Bearer $CRON_SECRET` runs incremental sync, then AI analysis, then feed items, plus the AI summary once a day.
   - `vercel.json` schedules it daily because the Vercel Hobby plan only allows daily cron jobs.
   - For near-real-time, either use Vercel Pro (`*/10 * * * *`), point any scheduler at the URL every 5–15 minutes (Supabase `pg_cron` + `pg_net`, GitHub Actions, cron-job.org), or turn on Gmail push (below).
3. **Gmail push (optional, near-real-time):**
   1. Create a Pub/Sub topic.
   2. Grant `gmail-api-push@system.gserviceaccount.com` the **Publisher** role on it.
   3. Create a **push** subscription to `{APP_URL}/api/gmail/push?token=$GMAIL_PUSH_TOKEN`.
   4. Set `GMAIL_PUBSUB_TOPIC=projects/<project>/topics/<topic>` and `GMAIL_PUSH_TOKEN`.

   The watch is registered when the mailbox connects and renewed by the cron job.

## Alternative: forwarding instead of Gmail API access

`POST /api/ingest/forward?mailbox=<address>` with `Authorization: Bearer $INGEST_SECRET` accepts any of these:

- raw MIME
- `{ "raw": "<base64>" }`
- Postmark's `RawEmail`
- SendGrid's raw `email` field

Use it with Cloudflare Email Routing + an Email Worker, Mailgun/SendGrid/Postmark inbound parsing, or a Gmail auto-forward filter. Auto-forwarding keeps the original sender. Forwarding by hand doesn't, so the brand can't be matched.

## Notes and limits

- **Brand matching:** emails are matched by sender domain, including subdomains such as `mail.crownrips.com`. If a brand sends from a different domain, add it under **Brand settings → Extra sending domains**.
- **Remote images:** blocked by default in previews. Loading a tracking pixel can register an "open", and that engagement may change the test account's CRM journey.
- **What the scores mean:** scores and "share of observed activity" describe what these inboxes received. They say nothing about market share, deliverability, conversion or profitability.
- **Campaigns are inferred:** confirm a campaign on its page once you've checked the grouping.
