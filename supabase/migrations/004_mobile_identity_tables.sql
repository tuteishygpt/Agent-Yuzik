alter table public.profiles
  add column if not exists profile_state jsonb not null default '{}'::jsonb;

alter table public.profiles
  alter column profile_state
  set default jsonb_build_object(
    'onboarding',
    jsonb_build_object('status', 'anonymous')
  );

update public.profiles
set profile_state = jsonb_build_object(
  'onboarding',
  jsonb_build_object(
    'status',
    case
      when coalesce(nullif(trim(onboarding_state), ''), 'anonymous') = 'linked'
        then 'linked'
      else 'anonymous'
    end
  )
)
where profile_state = '{}'::jsonb;

create unique index if not exists devices_user_install_unique_idx
  on public.devices (user_id, install_id_hash);

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_select_own'
  ) then
    create policy "profiles_select_own"
    on public.profiles
    for select
    to authenticated
    using ((select auth.uid()) = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_insert_own'
  ) then
    create policy "profiles_insert_own"
    on public.profiles
    for insert
    to authenticated
    with check ((select auth.uid()) = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_update_own'
  ) then
    create policy "profiles_update_own"
    on public.profiles
    for update
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'devices'
      and policyname = 'devices_manage_own'
  ) then
    create policy "devices_manage_own"
    on public.devices
    for all
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
  end if;
end
$$;
