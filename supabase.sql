-- vlipa studio — Supabase şeması
--
-- Supabase panelinde SQL Editor'ü aç, bunu bir kez çalıştır. Üç tablo yeter:
-- hesaplar, şirketler, görevler, tablolar ve mesajlar bunların içinde durur.
--
-- Bu tablolara yalnızca sunucu erişir ve gizli (secret / service_role) anahtar
-- kullanır. RLS açık ve hiçbir politika yok: gizli anahtar RLS'i zaten aşar,
-- tarayıcıya verilen publishable anahtar ise hiçbir satıra dokunamaz.

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

-- Süresi dolmuş oturumlar okunduklarında zaten siliniyor; bu, kimsenin
-- uğramadığı artıkları da temizler. İstersen ara sıra elle çalıştır.
-- delete from public.vlipa_kv where expires_at is not null and expires_at < now();
