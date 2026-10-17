-- Nuvem productivity workspace: account-scoped tasks and notes.
-- Run once in the Supabase SQL Editor before using the new Organization area.

create table if not exists public.app_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_tasks_user_status_due_idx
  on public.app_tasks(user_id, status, due_date asc);
create index if not exists app_tasks_user_updated_idx
  on public.app_tasks(user_id, updated_at desc);

alter table public.app_tasks enable row level security;
drop policy if exists app_tasks_select_own on public.app_tasks;
create policy app_tasks_select_own on public.app_tasks
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists app_tasks_insert_own on public.app_tasks;
create policy app_tasks_insert_own on public.app_tasks
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists app_tasks_update_own on public.app_tasks;
create policy app_tasks_update_own on public.app_tasks
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists app_tasks_delete_own on public.app_tasks;
create policy app_tasks_delete_own on public.app_tasks
  for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.app_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  content text not null default '' check (char_length(content) <= 20000),
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_notes_user_pinned_updated_idx
  on public.app_notes(user_id, is_pinned desc, updated_at desc);

alter table public.app_notes enable row level security;
drop policy if exists app_notes_select_own on public.app_notes;
create policy app_notes_select_own on public.app_notes
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists app_notes_insert_own on public.app_notes;
create policy app_notes_insert_own on public.app_notes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists app_notes_update_own on public.app_notes;
create policy app_notes_update_own on public.app_notes
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists app_notes_delete_own on public.app_notes;
create policy app_notes_delete_own on public.app_notes
  for delete to authenticated using (auth.uid() = user_id);
