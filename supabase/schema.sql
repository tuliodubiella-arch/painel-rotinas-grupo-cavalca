-- Painel de Rotinas | Grupo Cavalca
-- Execute este arquivo no SQL Editor do projeto Supabase.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Usuário',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.routines (
  id text primary key,
  company text not null default 'Grupo Cavalca',
  department text,
  title text not null,
  description text,
  owner text,
  frequency text,
  due_date date,
  status text not null default 'Pendente'
    check (status in ('Mapeada','Pendente','Em andamento','Concluída','Cancelada')),
  percent_complete integer not null default 0
    check (percent_complete between 0 and 100),
  priority text,
  observation text,
  source_updated_at date,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.routine_events (
  id bigint generated always as identity primary key,
  routine_id text not null references public.routines(id) on delete cascade,
  event_type text not null check (event_type in ('comment','action','status')),
  content text not null,
  status_from text,
  status_to text,
  author_id uuid not null references auth.users(id),
  author_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists routines_owner_idx on public.routines(owner);
create index if not exists routines_status_idx on public.routines(status);
create index if not exists routines_due_date_idx on public.routines(due_date);
create index if not exists routine_events_routine_idx
  on public.routine_events(routine_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists routines_set_updated_at on public.routines;
create trigger routines_set_updated_at
before update on public.routines
for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do update
    set full_name = excluded.full_name, email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.routines enable row level security;
alter table public.routine_events enable row level security;

drop policy if exists "Equipe visualiza perfis" on public.profiles;
create policy "Equipe visualiza perfis" on public.profiles
for select to authenticated using (true);

drop policy if exists "Usuário atualiza próprio perfil" on public.profiles;
create policy "Usuário atualiza próprio perfil" on public.profiles
for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Usuário cria próprio perfil" on public.profiles;
create policy "Usuário cria próprio perfil" on public.profiles
for insert to authenticated with check (auth.uid() = id);

drop policy if exists "Equipe visualiza rotinas" on public.routines;
create policy "Equipe visualiza rotinas" on public.routines
for select to authenticated using (true);

drop policy if exists "Equipe importa rotinas" on public.routines;
create policy "Equipe importa rotinas" on public.routines
for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "Equipe atualiza rotinas" on public.routines;
create policy "Equipe atualiza rotinas" on public.routines
for update to authenticated using (true) with check (auth.uid() = updated_by);

drop policy if exists "Equipe visualiza histórico" on public.routine_events;
create policy "Equipe visualiza histórico" on public.routine_events
for select to authenticated using (true);

drop policy if exists "Equipe registra histórico" on public.routine_events;
create policy "Equipe registra histórico" on public.routine_events
for insert to authenticated with check (auth.uid() = author_id);

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.routines to authenticated;
grant select, insert on public.routine_events to authenticated;
grant usage, select on sequence public.routine_events_id_seq to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.routines;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.routine_events;
exception when duplicate_object then null;
end $$;
