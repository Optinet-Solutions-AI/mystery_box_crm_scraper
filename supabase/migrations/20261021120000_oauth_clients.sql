-- Google OAuth clients managed in the app (instead of one client in env vars),
-- and per-mailbox settings so any number of research Gmail accounts can be used.

create table google_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id text not null unique,
  client_secret text not null,          -- encrypted with ENCRYPTION_KEY (enc:v1:...)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table google_oauth_clients enable row level security;

alter table mailboxes add column oauth_client_id uuid references google_oauth_clients(id) on delete set null;
alter table mailboxes add column label text;
alter table mailboxes add column active boolean not null default true;
