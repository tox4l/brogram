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
-- The policy IS the honesty of section 9: anyone can read the weights.
-- Deliberately NOT `to authenticated`: integrity_score() is invoker-rights
-- (correctly — making it definer would leak one learner's score to another),
-- and its only caller, apply_integrity_escalation(), is `security definer`,
-- so it runs as ITS OWNER, not as `authenticated`. If that owner is ever a
-- different role than the one this policy names, RLS hides every row from
-- the definer function, the left join in integrity_score() sees only NULLs,
-- coalesce(...,0) turns every score into 0, and warn/restrict/ban silently
-- stop firing for everyone — no error, no log line. A role-unqualified
-- policy (`for select using (true)`, no `to`) matches every role, including
-- whichever one owns the trigger function, and removes the failure mode
-- entirely rather than requiring the two roles to stay in sync by luck.
create policy integrity_weights_read on public.integrity_weights
  for select using (true);

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
--
-- window_days is clamped (1-400): an unclamped caller-supplied value can ask
-- for millennia of history (make_interval then raises "interval out of
-- range" instead of returning anything) and the brief's "at most 240 rows"
-- acceptance only holds for the intended window_days = 120 default.
--
-- The derot branch also guards the cast: drill_results is `jsonb` written by
-- append_drill_result() (which now validates `at` on the way in), but v1's
-- "own wellness" for all RLS policy still lets a learner write that column
-- directly, so a malformed element already stored (or a future direct
-- write) is skipped here rather than raising and 500-ing this function for
-- that learner forever.
create or replace function public.my_activity_days(window_days int default 120)
returns table (kind text, day date)
language sql security definer set search_path = public, pg_temp stable as $$
  with bounded as (
    select least(greatest(coalesce(window_days, 120), 1), 400) as days
  )
  select 'exercise', (created_at at time zone 'utc')::date
  from public.attempts, bounded
  where user_id = (select auth.uid()) and passed
    and created_at >= now() - make_interval(days => bounded.days)
  group by 2
  union all
  select 'derot', (r->>'at')::timestamptz::date
  from public.wellness w, bounded, jsonb_array_elements(w.drill_results) r
  where w.user_id = (select auth.uid())
    and jsonb_typeof(r->'at') = 'string'
    and (r->>'at') ~ '^\d{4}-\d{2}-\d{2}'
    and (r->>'at')::timestamptz >= now() - make_interval(days => bounded.days)
  group by 2;
$$;
revoke all on function public.my_activity_days(int) from public, anon;
grant execute on function public.my_activity_days(int) to authenticated;
