alter table public.drills add column lane text not null default 'arcade'
  check (lane in ('arcade','play'));
create index drills_lane_idx on public.drills (lane);

-- One statement: read-modify-write happens inside the database, capped at the
-- most recent 300, so two tabs cannot lose a run and the array cannot grow
-- without bound now that Playground runs are 60-120 seconds each.
create or replace function public.append_drill_result(result jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare trimmed jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  if not public.is_not_banned() then raise exception 'account is banned'; end if;
  update public.wellness w
     set drill_results = (
           select coalesce(jsonb_agg(x), '[]'::jsonb)
           from (
             select x from jsonb_array_elements(w.drill_results || jsonb_build_array(result)) x
             offset greatest(jsonb_array_length(w.drill_results) + 1 - 300, 0)
           ) s
         ),
         updated_at = now()
   where w.user_id = (select auth.uid())
   returning w.drill_results into trimmed;
  return coalesce(trimmed, '[]'::jsonb);
end $$;
revoke all on function public.append_drill_result(jsonb) from public, anon;
grant execute on function public.append_drill_result(jsonb) to authenticated;
