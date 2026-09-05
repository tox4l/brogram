create function public.integrity_score(uid uuid) returns int language sql stable as $$
  select coalesce(sum(case type when 'paste-blocked' then 2 when 'copy-blocked' then 2 when 'printscreen' then 3 when 'blur' then 1 else 0 end), 0)::int
  from public.integrity_events where user_id = uid and created_at > now() - interval '7 days'
$$;
create function public.apply_integrity_escalation() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare s int; paste_in_exercise int; st public.account_status;
begin
  if new.user_id::text = any (regexp_split_to_array(coalesce(current_setting('app.admin_user_ids', true), ''), '\s*,\s*')) then return new; end if;
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
create trigger integrity_escalation after insert on public.integrity_events for each row execute function public.apply_integrity_escalation();
