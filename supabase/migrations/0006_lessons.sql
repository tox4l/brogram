-- One lesson per CLO (R3.1): `id` is always set to the clo_id by the seed
-- loader. `version` alone carries staleness (bump it in place, keep the id) —
-- the first draft minted a new id per version, which orphaned every learner's
-- lesson_progress row on a rewrite because that table cascades on lesson_id.
create table public.lessons (
  id                text primary key,
  clo_id            text not null references public.clos(id) on delete cascade,
  course            text not null references public.courses(code) on delete cascade,
  language          text not null,
  version           int  not null default 1,
  title             text not null,
  hook              text not null,
  estimated_minutes int  not null,
  draft             boolean not null default false,
  tags              text[] not null default '{}',
  blocks            jsonb not null,
  exit_line         text not null,
  created_at        timestamptz not null default now()
);
create index lessons_clo_idx on public.lessons (clo_id);
create index lessons_course_idx on public.lessons (course);

-- Lessons contain micro-code reference solutions. The client reads the static
-- bundle, never this table, so nothing is granted to anon or authenticated.
alter table public.lessons enable row level security;
revoke all on public.lessons from anon, authenticated;

create table public.lesson_progress (
  user_id        uuid not null references auth.users(id) on delete cascade,
  lesson_id      text not null references public.lessons(id) on delete cascade,
  clo_id         text not null references public.clos(id) on delete cascade,
  status         text not null check (status in ('started','completed','skipped')),
  block_index    int  not null default 0,
  checks_passed  int  not null default 0,
  checks_failed  int  not null default 0,
  lesson_version int  not null default 1,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
alter table public.lesson_progress enable row level security;

-- updated_at has a default for the insert but nothing bumps it on update
-- (unlike learner_state, which folds the bump into its version-guard
-- trigger) unless every caller remembers to set it by hand.
create function public.lesson_progress_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger lesson_progress_touch before update on public.lesson_progress
  for each row execute function public.lesson_progress_touch();

create policy lesson_progress_select_own on public.lesson_progress
  for select to authenticated
  using ((select auth.uid()) = user_id and public.is_not_banned());
create policy lesson_progress_insert_own on public.lesson_progress
  for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_not_banned());
create policy lesson_progress_update_own on public.lesson_progress
  for update to authenticated
  using ((select auth.uid()) = user_id and public.is_not_banned())
  with check ((select auth.uid()) = user_id and public.is_not_banned());
