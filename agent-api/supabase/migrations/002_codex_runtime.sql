alter table public.conversations
    add column if not exists codex_thread_id text;

alter table public.agent_runs
    add column if not exists codex_turn_id text;

alter table public.canvas_workspaces
    add column if not exists snapshot jsonb;

revoke update on public.conversations from authenticated;
grant update (title, status, session_header, session_entries, session_revision, codex_thread_id) on public.conversations to authenticated;
revoke update on public.agent_runs from authenticated;
grant update (status, completed_at, codex_turn_id) on public.agent_runs to authenticated;
revoke update on public.canvas_workspaces from authenticated;
grant update (revision, snapshot) on public.canvas_workspaces to authenticated;

create or replace function public.save_canvas_state(
    target_project_id uuid,
    target_revision bigint,
    next_snapshot jsonb
)
returns setof public.canvas_workspaces
language plpgsql
security invoker
set search_path = ''
as $$
begin
    update public.canvas_workspaces w
    set revision = target_revision,
        snapshot = next_snapshot
    where w.project_id = target_project_id
      and target_revision > w.revision
      and (next_snapshot is null or jsonb_typeof(next_snapshot) = 'object');

    return query
    select w.* from public.canvas_workspaces w where w.project_id = target_project_id;
end;
$$;

revoke execute on function public.save_canvas_state(uuid, bigint, jsonb) from public, anon;
grant execute on function public.save_canvas_state(uuid, bigint, jsonb) to authenticated;
