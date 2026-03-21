alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.conversations enable row level security;
alter table public.adk_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.voice_turns enable row level security;
alter table public.teacher_sessions enable row level security;
alter table public.artifacts enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "devices_manage_own"
on public.devices
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "conversations_manage_own"
on public.conversations
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "adk_sessions_manage_own"
on public.adk_sessions
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "teacher_sessions_manage_own"
on public.teacher_sessions
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "voice_turns_manage_own"
on public.voice_turns
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "artifacts_manage_own"
on public.artifacts
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "chat_messages_manage_owned_conversations"
on public.chat_messages
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.conversations conversations
    where conversations.id = chat_messages.conversation_id
      and conversations.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.conversations conversations
    where conversations.id = chat_messages.conversation_id
      and conversations.user_id = (select auth.uid())
  )
);

insert into storage.buckets (id, name, public)
values
  ('user-uploads', 'user-uploads', false),
  ('assistant-artifacts', 'assistant-artifacts', false)
on conflict (id) do nothing;

create policy "storage_bucket_metadata_visible"
on storage.buckets
for select
to authenticated
using (id in ('user-uploads', 'assistant-artifacts'));

create policy "user_uploads_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'user-uploads'
  and split_part(name, '/', 1) = ((select auth.uid())::text)
);

create policy "user_uploads_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'user-uploads'
  and split_part(name, '/', 1) = ((select auth.uid())::text)
);

create policy "user_uploads_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'user-uploads'
  and split_part(name, '/', 1) = ((select auth.uid())::text)
)
with check (
  bucket_id = 'user-uploads'
  and split_part(name, '/', 1) = ((select auth.uid())::text)
);

create policy "user_uploads_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'user-uploads'
  and split_part(name, '/', 1) = ((select auth.uid())::text)
);

create policy "assistant_artifacts_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'assistant-artifacts'
  and split_part(name, '/', 1) = ((select auth.uid())::text)
);

create policy "assistant_artifacts_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'assistant-artifacts'
  and split_part(name, '/', 1) = ((select auth.uid())::text)
);

create policy "assistant_artifacts_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'assistant-artifacts'
  and split_part(name, '/', 1) = ((select auth.uid())::text)
)
with check (
  bucket_id = 'assistant-artifacts'
  and split_part(name, '/', 1) = ((select auth.uid())::text)
);

create policy "assistant_artifacts_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'assistant-artifacts'
  and split_part(name, '/', 1) = ((select auth.uid())::text)
);

