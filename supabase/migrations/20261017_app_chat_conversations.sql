-- Nuvem AI conversations and per-conversation message history.
-- Run this file once in the Supabase SQL Editor before using multi-chat.
create table if not exists public.app_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa' check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_chat_messages
  add column if not exists conversation_id uuid references public.app_chat_conversations(id) on delete cascade;
with inserted as (
  insert into public.app_chat_conversations(user_id, title)
  select distinct user_id, 'Conversa anterior'
  from public.app_chat_messages
  where not exists (
    select 1 from public.app_chat_conversations c where c.user_id = app_chat_messages.user_id
  )
  returning id, user_id
)
update public.app_chat_messages m
set conversation_id = i.id
from inserted i
where m.user_id = i.user_id and m.conversation_id is null;
create index if not exists app_chat_conversations_user_updated_idx
  on public.app_chat_conversations(user_id, updated_at desc);
create index if not exists app_chat_messages_conversation_created_idx
  on public.app_chat_messages(conversation_id, created_at asc);
alter table public.app_chat_conversations enable row level security;
drop policy if exists app_chat_conversations_select_own on public.app_chat_conversations;
create policy app_chat_conversations_select_own on public.app_chat_conversations
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists app_chat_conversations_insert_own on public.app_chat_conversations;
create policy app_chat_conversations_insert_own on public.app_chat_conversations
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists app_chat_conversations_update_own on public.app_chat_conversations;
create policy app_chat_conversations_update_own on public.app_chat_conversations
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists app_chat_conversations_delete_own on public.app_chat_conversations;
create policy app_chat_conversations_delete_own on public.app_chat_conversations
  for delete to authenticated using (auth.uid() = user_id);
