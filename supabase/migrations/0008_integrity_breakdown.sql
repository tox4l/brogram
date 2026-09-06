-- The printed spec SQL for this file joins public.integrity_weights before that
-- table exists (0003_integrity.sql inlines the weights as a `case` expression
-- inside integrity_score()). This is the corrected order: create and seed the
-- table first, then redefine integrity_score() to read it, then add the two
-- read paths. Same numbers, one source now. apply_integrity_escalation() is
-- untouched: it calls integrity_score(), which keeps its signature and results.
create table public.integrity_weights (
  type   text primary key,
  weight int  not null
);
insert into public.integrity_weights (type, weight) values
  ('paste-blocked', 2), ('copy-blocked', 2), ('printscreen', 3),
  ('blur', 1), ('contextmenu-blocked', 0), ('idle', 0);
alter table public.integrity_weights enable row level security;
-- The policy IS the honesty of section 9: a learner can read the weights.
create policy integrity_weights_read on public.integrity_weights
  for select to authenticated using (true);

create or replace function public.integrity_score(uid uuid) returns int
language sql stable as $$
  select coalesce(sum(coalesce(w.weight, 0)), 0)::int
  from public.integrity_events e
  left join public.integrity_weights w on w.type = e.type::text
  where e.user_id = uid and e.created_at > now() - interval '7 days'
$$;

-- Aggregate counts only, for the calling user only, over the same 7-day
-- window. No raw rows, no timestamps, no other users. integrity_events keeps
-- zero SELECT grants for non-admins.
create or replace function public.my_integrity_breakdown()
returns table (event_type text, events int, weight int, points int)
language sql security definer set search_path = public, pg_temp stable as $$
  select e.type::text, count(*)::int, coalesce(w.weight, 0)::int,
         (count(*) * coalesce(w.weight, 0))::int
  from public.integrity_events e
  left join public.integrity_weights w on w.type = e.type::text
  where e.user_id = (select auth.uid())
    and e.created_at >= now() - interval '7 days'
  group by e.type, w.weight
  order by 4 desc, 1 asc;
$$;
revoke all on function public.my_integrity_breakdown() from public, anon;
grant execute on function public.my_integrity_breakdown() to authenticated;

-- Distinct UTC activity dates for the calling user only. Bounded, aggregate,
-- and the only thing streak math needs. Replaces the layout's unbounded pager.
create or replace function public.my_activity_days(window_days int default 120)
returns table (kind text, day date)
language sql security definer set search_path = public, pg_temp stable as $$
  select 'exercise', (created_at at time zone 'utc')::date
  from public.attempts
  where user_id = (select auth.uid()) and passed
    and created_at >= now() - make_interval(days => window_days)
  group by 2
  union all
  select 'derot', (r->>'at')::timestamptz::date
  from public.wellness w, jsonb_array_elements(w.drill_results) r
  where w.user_id = (select auth.uid())
    and (r->>'at')::timestamptz >= now() - make_interval(days => window_days)
  group by 2;
$$;
revoke all on function public.my_activity_days(int) from public, anon;
grant execute on function public.my_activity_days(int) to authenticated;
