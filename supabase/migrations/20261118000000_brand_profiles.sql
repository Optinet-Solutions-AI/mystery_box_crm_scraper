-- AI-researched background for each tracked brand (one row per brand).
-- Web research (launch date, founders, location, what the brand does) plus
-- facts detected directly: website technology and the email/CRM platform
-- seen in the brand's emails.

create table brand_profiles (
  brand_id uuid primary key references brands(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'researching', 'ready', 'error')),
  overview text,
  category text,
  launch_date text,
  launch_date_source text,
  founders jsonb not null default '[]'::jsonb,        -- [{name, role, source_url}]
  headquarters text,
  headquarters_source text,
  legal_entity text,
  parent_company text,
  platform_summary text,                             -- AI summary of the tech / commerce platform
  site_tech jsonb not null default '[]'::jsonb,       -- detected from the website: [{name, category, evidence}]
  email_platforms jsonb not null default '[]'::jsonb, -- detected from received emails: [{name, emails}]
  business_model text,
  products text[] not null default '{}',
  markets text[] not null default '{}',
  payment_methods text[] not null default '{}',
  licensing text,
  funding text,
  social jsonb not null default '[]'::jsonb,          -- [{network, url}]
  facts jsonb not null default '[]'::jsonb,           -- [{fact, source_url}]
  sources jsonb not null default '[]'::jsonb,         -- [{title, url}]
  site_title text,
  site_description text,
  confidence numeric,
  caveats text,
  model text,
  error text,
  researched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table brand_profiles enable row level security;
