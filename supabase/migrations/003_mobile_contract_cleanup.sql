do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'teacher_sessions'
      and column_name = 'external_session_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'teacher_sessions'
      and column_name = 'session_id'
  ) then
    alter table public.teacher_sessions rename column external_session_id to session_id;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'teacher_sessions'
      and column_name = 'status'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'teacher_sessions'
      and column_name = 'lesson_status'
  ) then
    alter table public.teacher_sessions rename column status to lesson_status;
  end if;
end
$$;

alter table public.teacher_sessions
  drop constraint if exists teacher_sessions_status_valid;

update public.teacher_sessions
set lesson_status = 'stopped'
where lesson_status = 'errored';

alter table public.teacher_sessions
  add constraint teacher_sessions_lesson_status_valid
  check (lesson_status in ('idle', 'active', 'completed', 'stopped'));

alter table public.teacher_sessions
  add column if not exists mode text not null default 'teacher';

alter table public.teacher_sessions
  add column if not exists mistakes_to_review jsonb not null default '[]'::jsonb;

update public.teacher_sessions
set mode = coalesce(mode, 'teacher'),
    mistakes_to_review = coalesce(mistakes_to_review, '[]'::jsonb)
where mode is null
   or mistakes_to_review is null;

alter table public.voice_turns
  add column if not exists timestamp double precision;

update public.voice_turns
set timestamp = coalesce(timestamp, extract(epoch from created_at))
where timestamp is null;

alter table public.voice_turns
  alter column timestamp set not null;

alter table public.voice_turns
  alter column timestamp set default extract(epoch from timezone('utc', now()));

create index if not exists voice_turns_user_timestamp_idx
  on public.voice_turns (user_id, timestamp asc);
