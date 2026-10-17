-- Nuvem AI: múltiplas conversas por usuário.
-- Idempotente: pode ser executada novamente sem apagar mensagens existentes.
begin;

create table if not exists public.app_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa' check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_chat_messages
  add column if not exists conversation_id uuid references public.app_chat_conversations(id) on delete cascade;

-- Cria uma conversa para cada usuário que ainda tenha mensagens sem vínculo.
insert into public.app_chat_conversations (user_id, title)
select distinct m.user_id, 'Conversa anterior'
from public.app_chat_messages m
where m.conversation_id is null
  and not exists (
    select 1 from public.app_chat_conversations c where c.user_id = m.user_id
  );

-- Vincula mensagens antigas que ainda estejam sem conversa à conversa mais antiga do próprio usuário.
update public.app_chat_messages m
set conversation_id = (
  select c.id
  from public.app_chat_conversations c
  where c.user_id = m.user_id
  order by c.created_at asc, c.id asc
  limit 1
)
where m.conversation_id is null
  and exists (select 1 from public.app_chat_conversations c where c.user_id = m.user_id);

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

commit;
