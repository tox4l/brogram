-- Hosted Supabase denies both `alter database ... set app.admin_user_ids` and
-- `alter role ... set app.admin_user_ids` ("permission denied to set parameter"),
-- so the integrity-escalation exemption in 0003_integrity.sql cannot rely on a
-- database-level setting here. This table is the workaround: a service-role-only
-- allowlist the trigger function also checks. The current_setting() branch stays
-- in place (harmless if the setting is ever available in another environment).
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
-- no client policies: service role only
revoke all on public.admin_users from anon, authenticated;

create or replace function public.apply_integrity_escalation() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare s int; paste_in_exercise int; st public.account_status;
begin
  if new.user_id::text = any (regexp_split_to_array(coalesce(current_setting('app.admin_user_ids', true), ''), '\s*,\s*'))
     or exists (select 1 from public.admin_users a where a.user_id = new.user_id) then return new; end if;
  s := public.integrity_score(new.user_id);
  select count(*) into paste_in_exercise from public.integrity_events where user_id = new.user_id and exercise_id = new.exercise_id and type = 'paste-blocked' and created_at > now() - interval '7 days';
  select account_status into st from public.profiles where id = new.user_id;
  if st = 'banned' then return new; end if;
  if s >= 40 then
    update public.profiles set account_status = 'banned' where id = new.user_id;
  elsif s >= 20 or paste_in_exercise >= 5 then
    update public.profiles set account_status = 'restricted',
      restricted_until = case
        when st <> 'restricted' or restricted_until is null or restricted_until < now()
          then now() + interval '24 hours'
        else restricted_until
      end
    where id = new.user_id;
  elsif s >= 10 and st = 'active' then
    update public.profiles set account_status = 'warned' where id = new.user_id;
  end if;
  return new;
end $$;
