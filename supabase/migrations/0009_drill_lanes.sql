alter table public.drills add column lane text not null default 'arcade'
  check (lane in ('arcade','play'));
create index drills_lane_idx on public.drills (lane);

-- One statement: read-modify-write happens inside the database, capped at the
-- most recent 300, so two tabs cannot lose a run and the array cannot grow
-- without bound now that Playground runs are 60-120 seconds each.
--
-- Validates `result`'s shape before it is ever appended (kind is one of the
-- twelve DrillKinds, lane is one of the two DrillLanes, `at` is a real
-- timestamp, the numeric fields are numbers): a client bug or a direct write
-- through the wellness table's own "for all" policy that stored garbage used
-- to be discoverable only when my_activity_days() later raised on the bad
-- cast, breaking that learner's whole dashboard. Now it is rejected here,
-- loudly, at the point of write.
--
-- If no `wellness` row exists for this user the UPDATE matches zero rows;
-- the old version returned '[]'::jsonb in that case, which looks exactly
-- like a successful, empty history to the caller and silently drops the
-- run. `if not found` turns that into a raised exception instead.
--
-- `with ordinality` plus `order by` in jsonb_agg makes the trim
-- deterministic: jsonb_array_elements' row order is not a documented
-- guarantee, only an implementation detail of the current planner.
create or replace function public.append_drill_result(result jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare trimmed jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  if not public.is_not_banned() then raise exception 'account is banned'; end if;

  if not (result ? 'drillId') or trim(result->>'drillId') = '' then
    raise exception 'append_drill_result: drillId is required';
  end if;
  if result->>'kind' is null or result->>'kind' not in (
       'predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type',
       'follow-the-dot', 'color-nback', 'reaction', 'rhythm', 'breathe', 'memory-grid'
     ) then
    raise exception 'append_drill_result: invalid kind %', result->>'kind';
  end if;
  if result->>'lane' is null or result->>'lane' not in ('arcade', 'play') then
    raise exception 'append_drill_result: invalid lane %', result->>'lane';
  end if;
  if jsonb_typeof(result->'correct') is distinct from 'boolean' then
    raise exception 'append_drill_result: correct must be a boolean';
  end if;
  if jsonb_typeof(result->'timeMs') is distinct from 'number' or jsonb_typeof(result->'score') is distinct from 'number' then
    raise exception 'append_drill_result: timeMs and score must be numbers';
  end if;
  begin
    perform (result->>'at')::timestamptz;
  exception when others then
    raise exception 'append_drill_result: at is not a valid timestamp: %', result->>'at';
  end;

  update public.wellness w
     set drill_results = (
           select coalesce(jsonb_agg(x.val order by x.ord), '[]'::jsonb)
           from jsonb_array_elements(w.drill_results || jsonb_build_array(result)) with ordinality as x(val, ord)
           where x.ord > greatest(jsonb_array_length(w.drill_results) + 1 - 300, 0)
         ),
         updated_at = now()
   where w.user_id = (select auth.uid())
   returning w.drill_results into trimmed;

  if not found then
    raise exception 'append_drill_result: no wellness row for this user';
  end if;

  return trimmed;
end $$;
revoke all on function public.append_drill_result(jsonb) from public, anon;
grant execute on function public.append_drill_result(jsonb) to authenticated;
