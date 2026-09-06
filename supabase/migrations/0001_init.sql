create type account_status as enum ('active','warned','restricted','banned');
create type exercise_origin as enum ('seed','generated');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  account_status account_status not null default 'active',
  restricted_until timestamptz,
  invite_code text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create table public.invites (
  code text primary key,
  email text not null unique,
  created_by uuid references auth.users,
  redeemed_by uuid references auth.users,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.courses (
  code text primary key, slug text not null unique, title text not null,
  language text not null, secondary_language text, runtime text not null,
  level int not null, prerequisites text[] not null default '{}', topics text[] not null default '{}',
  clo_ids text[] not null default '{}', status text not null default 'live', packages text[] not null default '{}'
);
create table public.clos (
  id text primary key, course text not null references public.courses(code), ordinal int not null,
  outcome text not null, topics text[] not null default '{}', prerequisites text[] not null default '{}',
  patterns text[] not null default '{}', assessable_in_code boolean not null default true, draft boolean not null default false
);
create table public.patterns (id text primary key, name text not null, description text not null, family text not null);
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  clo_id text not null references public.clos(id), language text not null, kind text not null,
  difficulty int not null check (difficulty between 1 and 5), pattern text not null references public.patterns(id),
  title text not null, prompt text not null, starter_code text not null default '',
  tests jsonb not null, reference_solution text not null, origin exercise_origin not null default 'seed',
  parent_exercise_id uuid references public.exercises(id), author_user_id uuid references auth.users on delete set null,
  verified boolean not null default true, tags text[] not null default '{}', fixture text,
  created_at timestamptz not null default now()
);
create index on public.exercises (clo_id, pattern, difficulty);
create table public.attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  exercise_id uuid not null references public.exercises(id), code text not null, results jsonb not null,
  passed boolean not null, duration_ms int not null default 0, hint_count int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.attempts (user_id, created_at desc);
create index on public.attempts (user_id, exercise_id);
create table public.mastery (
  user_id uuid not null references auth.users on delete cascade, clo_id text not null references public.clos(id),
  score int not null default 0, chain int not null default 0, patterns_passed text[] not null default '{}',
  closed boolean not null default false, last_attempt_at timestamptz, primary key (user_id, clo_id)
);
create table public.learner_state (
  user_id uuid primary key references auth.users on delete cascade,
  state jsonb not null, version int not null default 0, updated_at timestamptz not null default now()
);
create table public.integrity_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  type text not null, exercise_id uuid, during_attempt boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.integrity_events (user_id, created_at desc);
create table public.wellness (
  user_id uuid primary key references auth.users on delete cascade,
  prefs jsonb not null default '{}', pomodoro_sessions jsonb not null default '[]',
  water_log jsonb not null default '[]', drill_results jsonb not null default '[]', updated_at timestamptz not null default now()
);
create table public.buddy_messages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('user','assistant')), content text not null, created_at timestamptz not null default now()
);
create table public.drills (
  id text primary key, kind text not null, language text, difficulty int not null check (difficulty between 1 and 5),
  time_limit_s int not null, payload jsonb not null
);
create table public.agent_usage (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  agent text not null, trigger text not null, prompt_tokens int not null default 0, completion_tokens int not null default 0,
  cache_hit_tokens int not null default 0, fallback boolean not null default false, created_at timestamptz not null default now()
);
create index on public.agent_usage (user_id, created_at desc);

-- helper predicates (stable, per-statement)
create function public.is_not_banned() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select account_status <> 'banned' from public.profiles where id = (select auth.uid())), false)
$$;
create function public.can_attempt() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select account_status in ('active','warned') or (account_status = 'restricted' and restricted_until < now())
    from public.profiles where id = (select auth.uid())), false)
$$;

-- the ONLY client-readable shape of the bank: no reference solution; seed rows plus the caller's own generated rows
create view public.exercises_public as
select id, clo_id, language, kind, difficulty, pattern, title, prompt, starter_code, tests, origin, parent_exercise_id, author_user_id, verified, tags, fixture, created_at
from public.exercises
where public.is_not_banned() and (origin = 'seed' or author_user_id = (select auth.uid()));
-- owner rights on purpose: the base table is not readable by clients
revoke all on public.exercises from anon, authenticated;
revoke all on public.exercises_public from anon, authenticated, public;
grant select on public.exercises_public to authenticated;
alter view public.exercises_public set (security_barrier = true);

-- learner_state version guard
create function public.learner_state_version_guard() returns trigger language plpgsql as $$
begin
  if new.version <> old.version + 1 then raise exception 'stale learner_state version (expected %, got %)', old.version + 1, new.version; end if;
  new.updated_at := now(); return new;
end $$;
create trigger learner_state_version_guard before update on public.learner_state for each row execute function public.learner_state_version_guard();

-- profile bootstrap and invite redemption on first sign-in (user row exists here)
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.wellness (user_id) values (new.id) on conflict do nothing;
  update public.invites set redeemed_at = now(), redeemed_by = new.id where email = lower(new.email) and redeemed_at is null;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- students may never change their own status columns, even if a grant slips later
create function public.profile_guard() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') and (
     new.account_status is distinct from old.account_status
     or new.restricted_until is distinct from old.restricted_until
     or new.invite_code is distinct from old.invite_code) then
    raise exception 'profile status columns are read-only for users';
  end if;
  return new;
end $$;
create trigger profile_guard before update on public.profiles for each row execute function public.profile_guard();

-- restriction expiry is explicit: called by the app layout on load
create function public.lift_expired_restriction() returns void language sql security definer set search_path = public, pg_temp as $$
  update public.profiles set account_status = 'warned'
  where id = (select auth.uid()) and account_status = 'restricted' and restricted_until < now()
$$;
grant execute on function public.lift_expired_restriction to authenticated;

-- RLS
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.courses enable row level security;
alter table public.clos enable row level security;
alter table public.patterns enable row level security;
alter table public.exercises enable row level security;
alter table public.attempts enable row level security;
alter table public.mastery enable row level security;
alter table public.learner_state enable row level security;
alter table public.integrity_events enable row level security;
alter table public.wellness enable row level security;
alter table public.buddy_messages enable row level security;
alter table public.drills enable row level security;
alter table public.agent_usage enable row level security;

create policy "own profile" on public.profiles for select using (id = (select auth.uid()));
revoke update on public.profiles from anon, authenticated;
grant update (display_name, last_seen_at) on public.profiles to authenticated;
create policy "own profile update" on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "read curriculum" on public.courses for select using (public.is_not_banned());
create policy "read clos" on public.clos for select using (public.is_not_banned());
create policy "read patterns" on public.patterns for select using (public.is_not_banned());
create policy "read drills" on public.drills for select using (public.is_not_banned());
-- exercises: no client policy at all; service role bypasses RLS
create policy "own attempts" on public.attempts for select using (user_id = (select auth.uid()) and public.is_not_banned());
create policy "insert attempts" on public.attempts for insert with check (user_id = (select auth.uid()) and public.can_attempt());
create policy "own mastery" on public.mastery for all using (user_id = (select auth.uid()) and public.is_not_banned()) with check (user_id = (select auth.uid()) and public.is_not_banned());
create policy "own state" on public.learner_state for all using (user_id = (select auth.uid()) and public.is_not_banned()) with check (user_id = (select auth.uid()) and public.is_not_banned());
create policy "insert integrity" on public.integrity_events for insert with check (user_id = (select auth.uid()));
create policy "own wellness" on public.wellness for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own buddy" on public.buddy_messages for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- invites and agent_usage: no client access; service key only.
