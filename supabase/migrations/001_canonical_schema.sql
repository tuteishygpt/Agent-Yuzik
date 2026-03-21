create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  onboarding_state text not null default 'anonymous',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  install_id_hash text not null,
  platform text not null default 'web',
  app_version text,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint devices_install_id_hash_not_blank check (length(trim(install_id_hash)) > 0),
  constraint devices_user_install_unique unique (user_id, install_id_hash)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_message_at timestamptz not null default timezone('utc', now()),
  constraint conversations_status_valid check (status in ('active', 'archived', 'cleared'))
);

create unique index if not exists conversations_one_active_per_user_idx
  on public.conversations (user_id)
  where status = 'active';

create index if not exists conversations_user_created_at_idx
  on public.conversations (user_id, created_at desc);

create table if not exists public.adk_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  adk_app_name text not null,
  adk_session_id text not null,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_used_at timestamptz not null default timezone('utc', now()),
  constraint adk_sessions_status_valid check (status in ('active', 'closed', 'errored')),
  constraint adk_sessions_app_session_unique unique (adk_app_name, adk_session_id)
);

create unique index if not exists adk_sessions_one_active_per_user_app_idx
  on public.adk_sessions (user_id, adk_app_name)
  where status = 'active';

create index if not exists adk_sessions_user_last_used_idx
  on public.adk_sessions (user_id, last_used_at desc);

create table if not exists public.teacher_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  external_session_id text not null,
  lesson_id text not null,
  current_step_id text not null,
  attempt_count integer not null default 0,
  status text not null default 'active',
  recent_turn_summary text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint teacher_sessions_status_valid check (status in ('active', 'completed', 'stopped', 'errored')),
  constraint teacher_sessions_attempt_count_non_negative check (attempt_count >= 0),
  constraint teacher_sessions_user_external_unique unique (user_id, external_session_id)
);

create index if not exists teacher_sessions_user_status_idx
  on public.teacher_sessions (user_id, status, updated_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  content text not null default '',
  content_type text not null default 'text',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint chat_messages_role_valid check (role in ('user', 'assistant', 'system')),
  constraint chat_messages_content_type_valid check (content_type in ('text', 'markdown', 'json', 'file'))
);

create index if not exists chat_messages_conversation_created_at_idx
  on public.chat_messages (conversation_id, created_at asc);

create index if not exists chat_messages_user_created_at_idx
  on public.chat_messages (user_id, created_at desc);

create table if not exists public.voice_turns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  teacher_session_id uuid references public.teacher_sessions (id) on delete set null,
  session_id text,
  user_text text not null,
  assistant_text text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists voice_turns_user_created_at_idx
  on public.voice_turns (user_id, created_at desc);

create index if not exists voice_turns_teacher_session_idx
  on public.voice_turns (teacher_session_id, created_at asc);

create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  adk_session_row_id uuid references public.adk_sessions (id) on delete set null,
  bucket text not null,
  object_path text not null,
  filename text not null,
  mime_type text not null,
  artifact_kind text not null,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint artifacts_kind_valid check (
    artifact_kind in ('upload', 'assistant_audio', 'assistant_image', 'assistant_file')
  ),
  constraint artifacts_size_non_negative check (size_bytes is null or size_bytes >= 0),
  constraint artifacts_bucket_object_unique unique (bucket, object_path)
);

create index if not exists artifacts_user_created_at_idx
  on public.artifacts (user_id, created_at desc);

create index if not exists artifacts_conversation_created_at_idx
  on public.artifacts (conversation_id, created_at desc);

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger devices_set_updated_at
before update on public.devices
for each row
execute function public.set_updated_at();

create trigger conversations_set_updated_at
before update on public.conversations
for each row
execute function public.set_updated_at();

create trigger adk_sessions_set_updated_at
before update on public.adk_sessions
for each row
execute function public.set_updated_at();

create trigger teacher_sessions_set_updated_at
before update on public.teacher_sessions
for each row
execute function public.set_updated_at();

create trigger chat_messages_set_updated_at
before update on public.chat_messages
for each row
execute function public.set_updated_at();

create trigger voice_turns_set_updated_at
before update on public.voice_turns
for each row
execute function public.set_updated_at();

create trigger artifacts_set_updated_at
before update on public.artifacts
for each row
execute function public.set_updated_at();

