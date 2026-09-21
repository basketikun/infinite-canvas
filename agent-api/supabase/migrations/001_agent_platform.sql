create extension if not exists pgcrypto;

create table public.projects (
    id uuid primary key default gen_random_uuid(),
    owner_user_id uuid not null references auth.users(id) on delete cascade,
    name text not null check (length(trim(name)) > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.canvas_workspaces (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null unique references public.projects(id) on delete cascade,
    revision bigint not null default 0 check (revision >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.conversations (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    owner_user_id uuid not null references auth.users(id) on delete cascade,
    title text not null check (length(trim(title)) > 0),
    status text not null default 'active' check (status in ('active', 'archived')),
    session_storage_version integer not null default 1 check (session_storage_version = 1),
    session_revision bigint not null default 0 check (session_revision >= 0),
    session_header jsonb,
    session_entries jsonb not null default '[]'::jsonb check (jsonb_typeof(session_entries) = 'array'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.agent_runs (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    actor_user_id uuid not null references auth.users(id) on delete cascade,
    status text not null default 'running' check (status in ('running', 'completed', 'failed', 'aborted')),
    started_at timestamptz not null default now(),
    completed_at timestamptz
);

create unique index one_active_run_per_conversation
    on public.agent_runs (conversation_id)
    where status = 'running';

create table public.agent_events (
    sequence bigint generated always as identity primary key,
    protocol_version integer not null default 1 check (protocol_version = 1),
    run_id uuid not null references public.agent_runs(id) on delete cascade,
    project_id uuid not null references public.projects(id) on delete cascade,
    canvas_workspace_id uuid not null references public.canvas_workspaces(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    thread_id text not null,
    turn_id text not null,
    item_id text not null,
    type text not null check (type in (
        'run.started', 'assistant.delta', 'assistant.completed',
        'tool.started', 'tool.updated', 'tool.completed',
        'canvas.tool.requested', 'run.completed', 'run.failed', 'run.aborted'
    )),
    payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
    created_at timestamptz not null default now()
);

create index agent_events_conversation_sequence
    on public.agent_events (conversation_id, sequence);

create table public.project_skills (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    name text not null check (length(trim(name)) > 0),
    definition text not null,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (project_id, name)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger projects_updated_at before update on public.projects
for each row execute function public.set_updated_at();
create trigger canvas_workspaces_updated_at before update on public.canvas_workspaces
for each row execute function public.set_updated_at();
create trigger conversations_updated_at before update on public.conversations
for each row execute function public.set_updated_at();
create trigger project_skills_updated_at before update on public.project_skills
for each row execute function public.set_updated_at();

create or replace function public.guard_agent_run_start()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    conversation_status text;
begin
    select c.status into conversation_status
    from public.conversations c
    where c.id = new.conversation_id
    for update;

    if conversation_status is distinct from 'active' then
        raise exception 'conversation_not_active' using errcode = 'P0409';
    end if;
    return new;
end;
$$;

create trigger agent_runs_require_active_conversation before insert on public.agent_runs
for each row execute function public.guard_agent_run_start();

create or replace function public.guard_conversation_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.status = 'active' and new.status = 'archived' and exists (
        select 1 from public.agent_runs r
        where r.conversation_id = old.id and r.status = 'running'
    ) then
        raise exception 'conversation_busy' using errcode = 'P0409';
    end if;
    return new;
end;
$$;

create trigger conversations_reject_archive_while_running before update of status on public.conversations
for each row execute function public.guard_conversation_archive();

alter table public.projects enable row level security;
alter table public.canvas_workspaces enable row level security;
alter table public.conversations enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_events enable row level security;
alter table public.project_skills enable row level security;

create policy projects_owner_all on public.projects
for all to authenticated
using (auth.uid() is not null and owner_user_id = auth.uid())
with check (auth.uid() is not null and owner_user_id = auth.uid());

create policy canvas_workspaces_owner_all on public.canvas_workspaces
for all to authenticated
using (
    auth.uid() is not null and exists (
        select 1 from public.projects p
        where p.id = project_id and p.owner_user_id = auth.uid()
    )
)
with check (
    auth.uid() is not null and exists (
        select 1 from public.projects p
        where p.id = project_id and p.owner_user_id = auth.uid()
    )
);

create policy conversations_owner_all on public.conversations
for all to authenticated
using (
    auth.uid() is not null
    and owner_user_id = auth.uid()
    and exists (
        select 1 from public.projects p
        where p.id = project_id and p.owner_user_id = auth.uid()
    )
)
with check (
    auth.uid() is not null
    and owner_user_id = auth.uid()
    and exists (
        select 1 from public.projects p
        where p.id = project_id and p.owner_user_id = auth.uid()
    )
);

create policy agent_runs_owner_all on public.agent_runs
for all to authenticated
using (
    auth.uid() is not null and actor_user_id = auth.uid()
    and exists (
        select 1 from public.conversations c
        join public.projects p on p.id = c.project_id
        where c.id = agent_runs.conversation_id
          and c.owner_user_id = auth.uid()
          and p.owner_user_id = auth.uid()
    )
)
with check (
    auth.uid() is not null and actor_user_id = auth.uid()
    and exists (
        select 1 from public.conversations c
        join public.projects p on p.id = c.project_id
        where c.id = agent_runs.conversation_id
          and c.owner_user_id = auth.uid()
          and p.owner_user_id = auth.uid()
    )
);

create policy agent_events_owner_all on public.agent_events
for all to authenticated
using (
    auth.uid() is not null and exists (
        select 1
        from public.projects p
        join public.canvas_workspaces w on w.project_id = p.id
        join public.conversations c on c.project_id = p.id
        join public.agent_runs r on r.conversation_id = c.id
        where p.id = agent_events.project_id
          and w.id = agent_events.canvas_workspace_id
          and c.id = agent_events.conversation_id
          and r.id = agent_events.run_id
          and p.owner_user_id = auth.uid()
          and c.owner_user_id = auth.uid()
          and r.actor_user_id = auth.uid()
    )
)
with check (
    auth.uid() is not null and exists (
        select 1
        from public.projects p
        join public.canvas_workspaces w on w.project_id = p.id
        join public.conversations c on c.project_id = p.id
        join public.agent_runs r on r.conversation_id = c.id
        where p.id = agent_events.project_id
          and w.id = agent_events.canvas_workspace_id
          and c.id = agent_events.conversation_id
          and r.id = agent_events.run_id
          and p.owner_user_id = auth.uid()
          and c.owner_user_id = auth.uid()
          and r.actor_user_id = auth.uid()
    )
);

create policy project_skills_owner_all on public.project_skills
for all to authenticated
using (
    auth.uid() is not null and exists (
        select 1 from public.projects p
        where p.id = project_id and p.owner_user_id = auth.uid()
    )
)
with check (
    auth.uid() is not null and exists (
        select 1 from public.projects p
        where p.id = project_id and p.owner_user_id = auth.uid()
    )
);

revoke all on public.projects, public.canvas_workspaces, public.conversations, public.agent_runs, public.agent_events, public.project_skills from anon, authenticated;
revoke all on sequence public.agent_events_sequence_seq from anon, authenticated;

grant select, delete on public.projects to authenticated;
grant update (name) on public.projects to authenticated;
grant select on public.canvas_workspaces to authenticated;
grant update (revision) on public.canvas_workspaces to authenticated;
grant select, insert on public.conversations to authenticated;
grant update (title, status, session_header, session_entries, session_revision) on public.conversations to authenticated;
grant select, insert on public.agent_runs to authenticated;
grant update (status, completed_at) on public.agent_runs to authenticated;
grant select, insert on public.agent_events to authenticated;
grant select, insert, delete on public.project_skills to authenticated;
grant update (name, definition, enabled) on public.project_skills to authenticated;
grant usage, select on sequence public.agent_events_sequence_seq to authenticated;

create or replace function public.create_project_with_canvas(project_name text)
returns table (
    id uuid,
    owner_user_id uuid,
    name text,
    canvas_workspace_id uuid,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    created_project public.projects;
    created_canvas public.canvas_workspaces;
begin
    if auth.uid() is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;
    if length(trim(project_name)) = 0 then
        raise exception 'project name is required' using errcode = '22023';
    end if;

    insert into public.projects (owner_user_id, name)
    values (auth.uid(), trim(project_name))
    returning * into created_project;

    insert into public.canvas_workspaces (project_id)
    values (created_project.id)
    returning * into created_canvas;

    return query select
        created_project.id,
        created_project.owner_user_id,
        created_project.name,
        created_canvas.id,
        created_project.created_at,
        created_project.updated_at;
end;
$$;

create or replace function public.advance_canvas_revision(target_project_id uuid, target_revision bigint)
returns setof public.canvas_workspaces
language plpgsql
security invoker
set search_path = ''
as $$
begin
    update public.canvas_workspaces w
    set revision = target_revision
    where w.project_id = target_project_id
      and target_revision > w.revision;

    return query
    select w.* from public.canvas_workspaces w where w.project_id = target_project_id;
end;
$$;

create or replace function public.save_conversation_session(
    target_project_id uuid,
    target_conversation_id uuid,
    expected_revision bigint,
    next_header jsonb,
    next_entries jsonb
)
returns table (session_revision bigint)
language sql
security invoker
set search_path = ''
as $$
    update public.conversations c
    set session_header = next_header,
        session_entries = next_entries,
        session_revision = c.session_revision + 1
    where c.id = target_conversation_id
      and c.project_id = target_project_id
      and c.session_revision = expected_revision
      and jsonb_typeof(next_entries) = 'array'
    returning c.session_revision;
$$;

revoke execute on function public.create_project_with_canvas(text) from public, anon;
revoke execute on function public.advance_canvas_revision(uuid, bigint) from public, anon;
revoke execute on function public.save_conversation_session(uuid, uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.create_project_with_canvas(text) to authenticated;
grant execute on function public.advance_canvas_revision(uuid, bigint) to authenticated;
grant execute on function public.save_conversation_session(uuid, uuid, bigint, jsonb, jsonb) to authenticated;
