-- Admin-issued accounts (src/app/api/admin/users/create) upsert an unredeemed invite
-- for the target email before calling auth.admin.createUser, regardless of that
-- email's domain. The signup gate hook must treat any such invite as the allow-list
-- for its address, ahead of the .edu.qa domain check, or admin-created non-.edu.qa
-- accounts would be rejected at sign-up time.
create or replace function public.hook_gate_signup(event jsonb) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  em text := lower(event->'user'->>'email');
  invites_required boolean := coalesce(current_setting('app.invites_required', true), 'true') = 'true';
begin
  if em is not null and exists (select 1 from public.invites where email = em and redeemed_at is null) then
    return '{}'::jsonb;
  end if;
  if em is null or em !~ '\.edu\.qa$' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'BroGram is only open to .edu.qa email addresses.'));
  end if;
  if invites_required and not exists (select 1 from public.invites where email = em and redeemed_at is null) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'BroGram is invite-only right now. Ask Velocity for an invite.'));
  end if;
  return '{}'::jsonb;
end $$;
grant execute on function public.hook_gate_signup to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
revoke execute on function public.hook_gate_signup from authenticated, anon, public;
grant select on public.invites to supabase_auth_admin;
