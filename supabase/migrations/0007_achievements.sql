create table public.achievements (
  id                  text primary key,
  name                text not null,
  line                text not null,
  tier                text not null check (tier in ('bronze','silver','gold')),
  how                 text not null,
  visible_when_locked boolean not null default true,
  ordinal             int  not null   -- mirrored by Achievement.ordinal, src/lib/contracts.ts
);
alter table public.achievements enable row level security;
-- Catalogue data, no secrets: readable by any signed-in, non-banned learner.
create policy achievements_read on public.achievements
  for select to authenticated using (public.is_not_banned());

create table public.user_achievements (
  user_id        uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievements(id) on delete cascade,
  unlocked_at    timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.user_achievements enable row level security;

create policy user_achievements_select_own on public.user_achievements
  for select to authenticated
  using ((select auth.uid()) = user_id and public.is_not_banned());
-- Insert only. No update, no delete: an unlock is permanent and cannot be
-- rewritten, and the primary key makes a duplicate unlock impossible.
create policy user_achievements_insert_own on public.user_achievements
  for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_not_banned());
