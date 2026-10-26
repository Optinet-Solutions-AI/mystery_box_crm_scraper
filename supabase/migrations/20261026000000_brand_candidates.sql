-- Auto-detected signups: senders seen in a research inbox that aren't tracked yet.
-- The AI flags likely mystery box / rips / cards operators; a person confirms
-- (becomes a tracked brand) or dismisses (never suggested again).

create table brand_candidates (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,             -- registrable sender domain, e.g. newbrand.com
  display_name text,                       -- sender name, e.g. "NewBrand"
  sender_emails text[] not null default '{}',
  mailbox_id uuid references mailboxes(id) on delete set null,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  email_count int not null default 0,
  sample_subjects text[] not null default '{}',
  sample_snippets text[] not null default '{}',
  seen_message_ids text[] not null default '{}', -- so repeated scans don't double-count
  signup_detected_at timestamptz,          -- time of the first welcome / verify-your-email message
  signup_subject text,
  -- AI triage
  ai_checked_at timestamptz,
  ai_is_target boolean,                    -- true = mystery box / rips / cards operator
  ai_vertical text,
  ai_brand_name text,
  ai_website text,
  ai_confidence numeric,
  ai_reason text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed')),
  brand_id uuid references brands(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index brand_candidates_status_idx on brand_candidates (status, last_seen_at desc);
alter table brand_candidates enable row level security;
