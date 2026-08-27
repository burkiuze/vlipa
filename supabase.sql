-- vlipa studio — Supabase schema
--
-- Open the SQL Editor in Supabase and run this once. Three tables are enough:
-- accounts, companies, tasks, tables and messages all live inside them.
--
-- Only the server touches these tables, and it uses the secret (service_role)
-- key. Row level security is on with no policies at all: the secret key
-- bypasses RLS anyway, while the publishable key handed to browsers can reach
-- nothing here.

create table if not exists public.vlipa_kv (
  key        text primary key,
  value      jsonb not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.vlipa_set (
  key    text not null,
  member text not null,
  primary key (key, member)
);

create table if not exists public.vlipa_list (
  id         bigserial primary key,
  key        text not null,
  value      jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists vlipa_list_key_id on public.vlipa_list (key, id);
create index if not exists vlipa_kv_expires on public.vlipa_kv (expires_at);

alter table public.vlipa_kv   enable row level security;
alter table public.vlipa_set  enable row level security;
alter table public.vlipa_list enable row level security;

-- Expired sessions are dropped as soon as somebody reads them; this clears the
-- leftovers nobody ever comes back for. Run it by hand now and then if you like.
-- delete from public.vlipa_kv where expires_at is not null and expires_at < now();
