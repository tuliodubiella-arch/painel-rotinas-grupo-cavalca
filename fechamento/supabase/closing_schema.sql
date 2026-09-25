-- Execute no projeto Supabase existente. Estas tabelas são independentes do painel antigo.
create table if not exists public.fc_members (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  legacy_name text,
  is_admin boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.fc_is_member()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.fc_members where id = (select auth.uid()) and active);
$$;
create or replace function public.fc_is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.fc_members where id = (select auth.uid()) and active and is_admin);
$$;
revoke all on function public.fc_is_member() from public, anon;
revoke all on function public.fc_is_admin() from public, anon;
grant execute on function public.fc_is_member() to authenticated;
grant execute on function public.fc_is_admin() to authenticated;

create table if not exists public.fc_companies (
  id text primary key,
  name text not null,
  source_name text,
  cnpj text,
  category text not null default 'DEMAIS' check(category in ('HOLDING','DEMAIS')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists fc_companies_cnpj_unique on public.fc_companies(cnpj) where cnpj is not null;

create table if not exists public.fc_tasks (
  id text primary key,
  company_id text not null references public.fc_companies(id),
  account text not null,
  group_name text not null default 'OUTROS',
  responsible_id uuid references public.fc_members(id),
  responsible_legacy_name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists fc_tasks_company_idx on public.fc_tasks(company_id);

create table if not exists public.fc_targets (
  company_id text not null references public.fc_companies(id),
  competence text not null check(competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  category text not null default 'DEMAIS' check(category in ('HOLDING','DEMAIS')),
  sort_order integer not null,
  business_day integer check(business_day between 1 and 23),
  planned_date date,
  legacy_deadline date,
  delivery_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(company_id, competence)
);
create index if not exists fc_targets_month_idx on public.fc_targets(competence, category, sort_order);

create table if not exists public.fc_receipts (
  company_id text not null,
  competence text not null,
  department text not null check(department in ('financeiro','rh','estoque','fiscal')),
  status text not null check(status in ('Pendente','Recebido','N/A')),
  received_at timestamptz,
  updated_by uuid references public.fc_members(id),
  primary key(company_id, competence, department),
  foreign key(company_id, competence) references public.fc_targets(company_id, competence) on delete cascade,
  check((status = 'Recebido' and received_at is not null) or (status in ('Pendente','N/A') and received_at is null))
);

create table if not exists public.fc_activity_states (
  task_id text not null references public.fc_tasks(id),
  competence text not null check(competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'Não iniciado' check(status in ('Não iniciado','Em andamento','Pausado','Finalizado')),
  total_seconds integer not null default 0 check(total_seconds >= 0),
  started_at timestamptz,
  first_started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz,
  last_actor_id uuid references public.fc_members(id),
  primary key(task_id, competence)
);
create index if not exists fc_activity_states_month_idx on public.fc_activity_states(competence);

create table if not exists public.fc_activity_events (
  id uuid primary key,
  task_id text not null references public.fc_tasks(id),
  competence text not null,
  action text not null check(action in ('play','pause','stop')),
  actor_id uuid references public.fc_members(id),
  actor_legacy_name text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  elapsed_seconds integer not null default 0 check(elapsed_seconds >= 0)
);
create index if not exists fc_activity_events_task_idx on public.fc_activity_events(task_id, competence, occurred_at);

create table if not exists public.fc_holidays (
  date date primary key,
  name text not null,
  created_by uuid references public.fc_members(id)
);

create table if not exists public.fc_history_tasks (
  id text not null,
  competence text not null,
  company_id text references public.fc_companies(id),
  company text not null,
  account text not null,
  group_name text,
  owner_name text,
  status text,
  start_date date,
  end_date date,
  primary key(id, competence)
);

alter table public.fc_members enable row level security;
alter table public.fc_companies enable row level security;
alter table public.fc_tasks enable row level security;
alter table public.fc_targets enable row level security;
alter table public.fc_receipts enable row level security;
alter table public.fc_activity_states enable row level security;
alter table public.fc_activity_events enable row level security;
alter table public.fc_holidays enable row level security;
alter table public.fc_history_tasks enable row level security;

revoke all on public.fc_members, public.fc_companies, public.fc_tasks, public.fc_targets,
  public.fc_receipts, public.fc_activity_states, public.fc_activity_events,
  public.fc_holidays, public.fc_history_tasks from anon, authenticated;
grant select on public.fc_members, public.fc_companies, public.fc_tasks, public.fc_targets,
  public.fc_receipts, public.fc_activity_states, public.fc_activity_events,
  public.fc_holidays, public.fc_history_tasks to authenticated;
grant update on public.fc_members to authenticated;
grant insert, update on public.fc_companies, public.fc_tasks, public.fc_targets,
  public.fc_receipts, public.fc_holidays to authenticated;

drop policy if exists fc_members_read on public.fc_members;
create policy fc_members_read on public.fc_members for select to authenticated using ((select public.fc_is_member()));
drop policy if exists fc_members_update on public.fc_members;
create policy fc_members_update on public.fc_members for update to authenticated
  using ((select public.fc_is_admin())) with check ((select public.fc_is_admin()));

drop policy if exists fc_companies_read on public.fc_companies;
create policy fc_companies_read on public.fc_companies for select to authenticated using ((select public.fc_is_member()));
drop policy if exists fc_companies_insert on public.fc_companies;
create policy fc_companies_insert on public.fc_companies for insert to authenticated with check ((select public.fc_is_member()));
drop policy if exists fc_companies_update on public.fc_companies;
create policy fc_companies_update on public.fc_companies for update to authenticated
  using ((select public.fc_is_member())) with check ((select public.fc_is_member()));

drop policy if exists fc_tasks_read on public.fc_tasks;
create policy fc_tasks_read on public.fc_tasks for select to authenticated using ((select public.fc_is_member()));
drop policy if exists fc_tasks_insert on public.fc_tasks;
create policy fc_tasks_insert on public.fc_tasks for insert to authenticated with check ((select public.fc_is_member()));
drop policy if exists fc_tasks_update on public.fc_tasks;
create policy fc_tasks_update on public.fc_tasks for update to authenticated
  using ((select public.fc_is_member())) with check ((select public.fc_is_member()));

drop policy if exists fc_targets_read on public.fc_targets;
create policy fc_targets_read on public.fc_targets for select to authenticated using ((select public.fc_is_member()));
drop policy if exists fc_targets_insert on public.fc_targets;
create policy fc_targets_insert on public.fc_targets for insert to authenticated with check ((select public.fc_is_member()));
drop policy if exists fc_targets_update on public.fc_targets;
create policy fc_targets_update on public.fc_targets for update to authenticated
  using ((select public.fc_is_member())) with check ((select public.fc_is_member()));

drop policy if exists fc_receipts_read on public.fc_receipts;
create policy fc_receipts_read on public.fc_receipts for select to authenticated using ((select public.fc_is_member()));
drop policy if exists fc_receipts_insert on public.fc_receipts;
create policy fc_receipts_insert on public.fc_receipts for insert to authenticated with check ((select public.fc_is_member()));
drop policy if exists fc_receipts_update on public.fc_receipts;
create policy fc_receipts_update on public.fc_receipts for update to authenticated
  using ((select public.fc_is_member())) with check ((select public.fc_is_member()));

drop policy if exists fc_activity_states_read on public.fc_activity_states;
create policy fc_activity_states_read on public.fc_activity_states for select to authenticated using ((select public.fc_is_member()));
drop policy if exists fc_activity_events_read on public.fc_activity_events;
create policy fc_activity_events_read on public.fc_activity_events for select to authenticated using ((select public.fc_is_member()));

drop policy if exists fc_holidays_read on public.fc_holidays;
create policy fc_holidays_read on public.fc_holidays for select to authenticated using ((select public.fc_is_member()));
drop policy if exists fc_holidays_insert on public.fc_holidays;
create policy fc_holidays_insert on public.fc_holidays for insert to authenticated with check ((select public.fc_is_member()));
drop policy if exists fc_holidays_update on public.fc_holidays;
create policy fc_holidays_update on public.fc_holidays for update to authenticated
  using ((select public.fc_is_member())) with check ((select public.fc_is_member()));

drop policy if exists fc_history_tasks_read on public.fc_history_tasks;
create policy fc_history_tasks_read on public.fc_history_tasks for select to authenticated using ((select public.fc_is_member()));

create or replace function public.fc_apply_activity(
  p_event_id uuid, p_task_id text, p_competence text, p_action text, p_occurred_at timestamptz
) returns public.fc_activity_states
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_state public.fc_activity_states%rowtype;
  v_company text;
  v_elapsed integer := 0;
begin
  if not public.fc_is_member() then raise exception 'Acesso não autorizado'; end if;
  if p_event_id is null or p_task_id is null or p_competence !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or p_action not in ('play','pause','stop') or p_occurred_at is null
    or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'Apontamento inválido';
  end if;
  select company_id into v_company from public.fc_tasks where id = p_task_id and active;
  if v_company is null then raise exception 'Rotina não encontrada'; end if;
  insert into public.fc_targets(company_id, competence, category, sort_order)
    select id, p_competence, category, 9999 from public.fc_companies where id = v_company
    on conflict (company_id, competence) do nothing;
  insert into public.fc_activity_states(task_id, competence) values(p_task_id, p_competence) on conflict do nothing;
  select * into v_state from public.fc_activity_states where task_id = p_task_id and competence = p_competence for update;
  if exists(select 1 from public.fc_activity_events where id = p_event_id) then return v_state; end if;
  if v_state.updated_at is not null and p_occurred_at < v_state.updated_at then
    raise exception 'Há um apontamento mais recente nesta rotina. Atualize os dados antes de sincronizar.';
  end if;
  if p_action = 'play' and v_state.status = 'Em andamento' then return v_state; end if;
  if p_action = 'pause' and v_state.status <> 'Em andamento' then raise exception 'A rotina não está em andamento'; end if;
  if p_action = 'stop' and v_state.status = 'Finalizado' then return v_state; end if;
  if p_action in ('pause','stop') and v_state.status = 'Em andamento' and v_state.started_at is not null then
    v_elapsed := greatest(0, floor(extract(epoch from p_occurred_at - v_state.started_at))::integer);
  end if;
  insert into public.fc_activity_events(id, task_id, competence, action, actor_id, occurred_at, elapsed_seconds)
    values(p_event_id, p_task_id, p_competence, p_action, auth.uid(), p_occurred_at, v_elapsed);
  update public.fc_activity_states set
    status = case p_action when 'play' then 'Em andamento' when 'pause' then 'Pausado' else 'Finalizado' end,
    total_seconds = total_seconds + v_elapsed,
    started_at = case when p_action = 'play' then p_occurred_at else null end,
    first_started_at = coalesce(first_started_at, case when p_action = 'play' then p_occurred_at else null end),
    finished_at = case when p_action = 'stop' then p_occurred_at else null end,
    updated_at = p_occurred_at,
    last_actor_id = auth.uid()
  where task_id = p_task_id and competence = p_competence returning * into v_state;
  if p_action = 'stop' and not exists(
    select 1 from public.fc_tasks t where t.company_id = v_company and t.active and not exists(
      select 1 from public.fc_activity_states s where s.task_id = t.id and s.competence = p_competence and s.status = 'Finalizado'
    )
  ) then
    update public.fc_targets set delivery_at = (
      select max(s.finished_at) from public.fc_activity_states s
      join public.fc_tasks t on t.id = s.task_id
      where t.company_id = v_company and t.active and s.competence = p_competence
    ), updated_at = now()
    where company_id = v_company and competence = p_competence;
  else
    update public.fc_targets set delivery_at = null, updated_at = now()
    where company_id = v_company and competence = p_competence and delivery_at is not null;
  end if;
  return v_state;
end;
$$;
revoke all on function public.fc_apply_activity(uuid,text,text,text,timestamptz) from public, anon;
grant execute on function public.fc_apply_activity(uuid,text,text,text,timestamptz) to authenticated;

