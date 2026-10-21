-- CRM Competitor Intelligence: initial schema
-- All tables have RLS enabled with no policies, so only the server
-- (service role key) can read or write. The browser never talks to Supabase directly.

create extension if not exists pgcrypto;

-- ─── Industry templates ────────────────────────────────────────────────
-- Each industry declares extra offer fields the AI should extract and
-- extra email categories it may assign. One app, many verticals.
create table industries (
  id text primary key,
  name text not null,
  description text,
  extra_offer_fields jsonb not null default '[]'::jsonb, -- [{key,label,type,description}]
  extra_categories text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ─── Brands (tracked competitors, added manually) ──────────────────────
create table brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,                 -- e.g. crownrips.com
  website_url text,
  signup_url text,
  logo_url text,
  industry_id text not null default 'mystery_box' references industries(id),
  country text,
  sender_domains text[] not null default '{}', -- extra sending domains (ESP subdomains etc.)
  sender_emails text[] not null default '{}',  -- exact sender addresses to match
  color text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─── Mailboxes (research inboxes) ──────────────────────────────────────
create table mailboxes (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  provider text not null default 'gmail' check (provider in ('gmail', 'forwarding')),
  refresh_token text,          -- Gmail OAuth refresh token (server-only)
  access_token text,
  token_expires_at timestamptz,
  history_id text,             -- Gmail history cursor for incremental sync
  status text not null default 'disconnected'
    check (status in ('connected', 'error', 'disconnected', 'reauth_required')),
  last_error text,
  last_synced_at timestamptz,
  initial_sync_done boolean not null default false,
  watch_expires_at timestamptz, -- Gmail push (Pub/Sub) watch expiry
  created_at timestamptz not null default now()
);

-- ─── Test accounts (one signup per brand per persona) ──────────────────
create table test_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  mailbox_id uuid references mailboxes(id) on delete set null,
  email text not null,
  persona text not null default 'default',
  signup_method text default 'google',
  status text not null default 'pending' check (status in ('pending', 'registered', 'closed')),
  registered_at timestamptz,   -- lifecycle day 0
  -- Manually recorded actions (never assumed): deposits, purchases, logins...
  recorded_events jsonb not null default '[]'::jsonb, -- [{type, at, note}]
  notes text,
  created_at timestamptz not null default now(),
  unique (brand_id, email, persona)
);

-- ─── Campaigns (inferred groups of related emails) ─────────────────────
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  title text not null,
  signature text,                       -- normalized subject tokens used for matching
  primary_category text,
  categories text[] not null default '{}',
  offer_type text,
  offer_headline text,
  promo_codes text[] not null default '{}',
  landing_urls text[] not null default '{}',
  seasonal_event text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  email_count int not null default 0,
  offer_starts_at timestamptz,
  offer_ends_at timestamptz,
  confidence numeric,                   -- grouping confidence 0..1
  is_inferred boolean not null default true, -- always true unless a human confirms it
  confirmed_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_brand_idx on campaigns (brand_id, last_seen_at desc);

-- ─── Emails ────────────────────────────────────────────────────────────
create table emails (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,      -- gmail:<id> | msgid:<Message-ID> | sha:<hash>
  source text not null default 'gmail' check (source in ('gmail', 'forwarding')),
  mailbox_id uuid references mailboxes(id) on delete set null,
  brand_id uuid references brands(id) on delete set null,
  test_account_id uuid references test_accounts(id) on delete set null,
  campaign_id uuid references campaigns(id) on delete set null,
  campaign_role text,                   -- launch | follow_up | repeat | variation

  gmail_message_id text,
  gmail_thread_id text,
  message_id_header text,
  gmail_labels text[] not null default '{}',

  from_name text,
  from_email text,
  from_domain text,
  reply_to text,
  to_email text,
  subject text,
  preview_text text,
  sent_at timestamptz,
  received_at timestamptz,

  html_body text,
  text_body text,
  links jsonb not null default '[]'::jsonb,       -- [{url, text, is_cta, kind}]
  images jsonb not null default '[]'::jsonb,      -- [{src, alt, width, height, is_tracking}]
  attachments jsonb not null default '[]'::jsonb, -- [{filename, mime_type, size}]
  cta_links jsonb not null default '[]'::jsonb,   -- [{text, url}]
  promo_codes text[] not null default '{}',
  unsubscribe_url text,
  list_unsubscribe text,
  headers jsonb not null default '{}'::jsonb,

  -- Filtering & processing
  match_method text,                    -- from_domain | sender_email | reply_to | link_domain
  email_type text,                      -- promotional | transactional | security | auth_code | support | personal | other
  is_promotional boolean,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'analyzed', 'skipped', 'error')),
  processing_error text,
  processing_attempts int not null default 0,
  created_at timestamptz not null default now()
);
create index emails_brand_sent_idx on emails (brand_id, sent_at desc);
create index emails_status_idx on emails (processing_status);
create index emails_campaign_idx on emails (campaign_id);
create index emails_account_idx on emails (test_account_id, sent_at);

-- ─── AI analysis (one per email) ───────────────────────────────────────
create table email_analyses (
  email_id uuid primary key references emails(id) on delete cascade,
  model text,
  email_type text,
  is_promotional boolean,
  categories text[] not null default '{}',
  primary_category text,
  industry_categories text[] not null default '{}',
  manual_categories text[],             -- manual correction; overrides categories when set
  summary text,
  main_message text,
  promotional_angle text,
  tone text,
  copy_style text,
  urgency_tactics text[] not null default '{}',
  has_urgency boolean,
  subject_line_style text,
  emoji_count int,
  personalization text[] not null default '{}',
  is_personalized boolean,
  emotional_appeals text[] not null default '{}',
  social_proof text[] not null default '{}',
  content_focus text,                   -- promotional | educational | mixed | transactional
  cta_count int,
  cta_placement text,
  creative_format text,                 -- image_heavy | text_heavy | mixed
  hero_description text,
  featured_products text[] not null default '{}',
  partnerships text[] not null default '{}',
  seasonal_event text,
  campaign_theme text,
  confidence numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Offers (structured, one email can carry several) ──────────────────
create table offers (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references emails(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  offer_type text,                      -- discount | cashback | free_gift | bonus | free_box | ...
  headline text,
  incentive_value numeric,
  incentive_unit text,                  -- percent | currency | quantity | free_spins | boxes | credits | other
  incentive_text text,                  -- exact wording, e.g. "20% off"
  currency text,
  min_requirement text,
  min_requirement_amount numeric,
  max_reward text,
  max_reward_amount numeric,
  promo_code text,
  eligibility text,
  geo_restrictions text,
  starts_at timestamptz,
  ends_at timestamptz,
  starts_text text,
  ends_text text,
  product_category text,
  conditions text,
  cta_text text,
  cta_url text,
  confidence numeric,
  source_evidence text,                 -- exact supporting excerpt from the email
  industry_fields jsonb not null default '{}'::jsonb, -- {key: {value, evidence}}
  created_at timestamptz not null default now()
);
create index offers_brand_idx on offers (brand_id, created_at desc);
create index offers_ends_idx on offers (ends_at);

-- ─── Intelligence feed / findings / alerts ─────────────────────────────
create table insights (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                   -- new_campaign | new_offer | volume_change | offer_expiring | ai_finding | new_category | value_change
  severity text not null default 'info' check (severity in ('info', 'notable', 'important')),
  title text not null,
  body text,
  brand_ids uuid[] not null default '{}',
  email_ids uuid[] not null default '{}',
  campaign_ids uuid[] not null default '{}',
  offer_ids uuid[] not null default '{}',
  data jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  period_start timestamptz,
  period_end timestamptz,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index insights_created_idx on insights (created_at desc);

create table alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text not null,              -- new_campaign | new_offer | offer_expiring | volume_spike | keyword
  brand_id uuid references brands(id) on delete cascade, -- null = all brands
  params jsonb not null default '{}'::jsonb, -- e.g. {"threshold_pct": 50} or {"keyword": "cashback"}
  webhook_url text,                     -- optional Slack/Teams/any webhook
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─── Sync bookkeeping ──────────────────────────────────────────────────
create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid references mailboxes(id) on delete cascade,
  kind text not null,                   -- initial | incremental | manual | push | brand_backfill | forwarding
  status text not null default 'running' check (status in ('running', 'success', 'error', 'partial')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched int not null default 0,
  inserted int not null default 0,
  duplicates int not null default 0,
  ignored int not null default 0,
  analyzed int not null default 0,
  error text
);
create index sync_runs_started_idx on sync_runs (started_at desc);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ─── Lock everything down: server-only access ──────────────────────────
alter table industries enable row level security;
alter table brands enable row level security;
alter table mailboxes enable row level security;
alter table test_accounts enable row level security;
alter table campaigns enable row level security;
alter table emails enable row level security;
alter table email_analyses enable row level security;
alter table offers enable row level security;
alter table insights enable row level security;
alter table alert_rules enable row level security;
alter table sync_runs enable row level security;
alter table app_settings enable row level security;

-- ─── Seed: industry templates ──────────────────────────────────────────
insert into industries (id, name, description, extra_offer_fields, extra_categories) values
('mystery_box', 'Mystery boxes & rips', 'Mystery box, pack-opening and card-rip operators', $$[
  {"key":"box_price","label":"Box / pack price","type":"text","description":"Advertised price of the featured box, pack or rip"},
  {"key":"free_boxes","label":"Free boxes / packs","type":"text","description":"Number and value of free boxes, packs, spins or rips"},
  {"key":"deposit_bonus","label":"Deposit / top-up bonus","type":"text","description":"Bonus on deposit or balance top-up, % and cap"},
  {"key":"rakeback_cashback","label":"Rakeback / cashback","type":"text","description":"Rakeback, cashback or credit-back percentage"},
  {"key":"featured_items","label":"Featured chase items","type":"text","description":"Headline items: cards, graded slabs, sneakers, tech, etc."},
  {"key":"item_value_claims","label":"Item value / odds claims","type":"text","description":"Stated item values, odds, EV, RTP or hit rates"},
  {"key":"battles_events","label":"Battles / live rips / drops","type":"text","description":"Box battles, live breaks, limited drops, giveaways"},
  {"key":"level_rewards","label":"Levels / VIP rewards","type":"text","description":"Level-up, XP, tier or VIP rewards"},
  {"key":"referral_reward","label":"Referral reward","type":"text","description":"Reward for inviting friends or affiliate codes"},
  {"key":"payment_incentives","label":"Payment incentives","type":"text","description":"Crypto, card or specific payment-method incentives"},
  {"key":"shipping_buyback","label":"Shipping / buyback terms","type":"text","description":"Free shipping, instant buyback/sell-back percentages, vaulting"}
]$$::jsonb, array['box_drop','live_rip_event','giveaway','buyback_promo']),
('igaming', 'iGaming (casino & sportsbook)', 'Online casino and sportsbook operators', $$[
  {"key":"welcome_bonus","label":"Welcome bonus % and amount","type":"text","description":"Welcome bonus percentage and maximum amount"},
  {"key":"reload_bonus","label":"First-deposit / reload bonus","type":"text","description":"First-deposit and reload bonuses"},
  {"key":"free_spins","label":"Free spins and value","type":"text","description":"Number of free spins and stated value per spin"},
  {"key":"cashback_pct","label":"Cashback %","type":"text","description":"Cashback percentage and basis"},
  {"key":"wagering","label":"Wagering / rollover","type":"text","description":"Wagering multiplier and basis (bonus, deposit+bonus)"},
  {"key":"min_deposit","label":"Minimum deposit","type":"text","description":"Minimum qualifying deposit"},
  {"key":"max_bonus","label":"Maximum bonus","type":"text","description":"Maximum bonus amount"},
  {"key":"max_winnings","label":"Max winnings / withdrawal limits","type":"text","description":"Maximum winnings or withdrawal restrictions"},
  {"key":"eligible_games","label":"Eligible games","type":"text","description":"Games or markets the offer applies to"},
  {"key":"game_contribution","label":"Game contribution rules","type":"text","description":"How each game type contributes to wagering"},
  {"key":"odds_boosts_free_bets","label":"Odds boosts / free bets","type":"text","description":"Sportsbook odds boosts and free bets"},
  {"key":"payment_incentives","label":"Payment method incentives","type":"text","description":"Incentives tied to payment methods"},
  {"key":"vip_incentives","label":"VIP / loyalty incentives","type":"text","description":"VIP or loyalty-program incentives"},
  {"key":"responsible_gambling","label":"Responsible-gambling terms","type":"text","description":"Responsible-gambling conditions and restrictions, when stated"}
]$$::jsonb, array['odds_boost','free_bet','free_spins']),
('ecommerce', 'E-commerce', 'Online retail', $$[
  {"key":"discount","label":"Discount","type":"text","description":"Discount percentage or amount"},
  {"key":"products","label":"Products","type":"text","description":"Featured products"},
  {"key":"bundles","label":"Bundles","type":"text","description":"Bundle offers"},
  {"key":"shipping","label":"Shipping offer","type":"text","description":"Free or discounted shipping thresholds"},
  {"key":"free_gift","label":"Free gift","type":"text","description":"Gift with purchase"}
]$$::jsonb, array['abandoned_cart','back_in_stock']),
('fintech', 'Fintech', 'Banks, payments, investing', $$[
  {"key":"rates","label":"Rates","type":"text","description":"Interest/APY/APR rates"},
  {"key":"fees","label":"Fees","type":"text","description":"Fee waivers or changes"},
  {"key":"referral_incentive","label":"Referral incentive","type":"text","description":"Referral rewards"},
  {"key":"account_benefits","label":"Account benefits","type":"text","description":"Account tier benefits"}
]$$::jsonb, array[]::text[]),
('travel', 'Travel', 'Airlines, hotels, OTAs', $$[
  {"key":"destinations","label":"Destinations","type":"text","description":"Promoted destinations"},
  {"key":"seasonal_discount","label":"Seasonal discount","type":"text","description":"Seasonal discounts"},
  {"key":"loyalty_offer","label":"Loyalty offer","type":"text","description":"Points or loyalty offers"},
  {"key":"booking_window","label":"Booking / travel window","type":"text","description":"Booking and travel date windows"}
]$$::jsonb, array[]::text[]),
('subscription', 'Subscription products', 'SaaS and subscription services', $$[
  {"key":"trial_offer","label":"Trial offer","type":"text","description":"Free or discounted trial"},
  {"key":"renewal_discount","label":"Renewal discount","type":"text","description":"Renewal discounts"},
  {"key":"upgrade_offer","label":"Upgrade offer","type":"text","description":"Plan upgrade offers"},
  {"key":"churn_prevention","label":"Churn prevention","type":"text","description":"Win-back or cancellation-save offers"}
]$$::jsonb, array[]::text[]);

-- ─── Seed: the first three brands ──────────────────────────────────────
insert into brands (name, domain, website_url, signup_url, industry_id, color) values
('Crown Rips', 'crownrips.com', 'https://crownrips.com', 'https://crownrips.com', 'mystery_box', '#2a78d6'),
('Packz', 'packz.io', 'https://packz.io', 'https://packz.io', 'mystery_box', '#eb6834'),
('Courtyard', 'courtyard.io', 'https://courtyard.io', 'https://courtyard.io', 'mystery_box', '#1baf7a');

insert into app_settings (key, value) values
('scorecard_weights', '{"aggressiveness":1,"intensity":1,"variety":1,"lifecycle":1,"creative":1,"consistency":1}'::jsonb),
('sync', '{"initial_sync_days":90}'::jsonb);
