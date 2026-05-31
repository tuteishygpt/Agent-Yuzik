create table if not exists public.dialogue_logs (
  id uuid primary key default gen_random_uuid(),
  log_path text not null,
  source text not null,
  user_id text not null,
  user_label text,
  user_text text not null default '',
  assistant_text text not null default '',
  logged_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint dialogue_logs_user_id_not_blank check (length(trim(user_id)) > 0),
  constraint dialogue_logs_source_not_blank check (length(trim(source)) > 0)
);

create index if not exists dialogue_logs_user_logged_at_idx
  on public.dialogue_logs (user_id, logged_at desc);

create index if not exists dialogue_logs_source_logged_at_idx
  on public.dialogue_logs (source, logged_at desc);

alter table public.dialogue_logs enable row level security;
