-- Review and install manually as postgres. This file is NOT run by the app.
-- No table or RLS changes. No email search or directory access.
begin;
create function public.trip_participant_display(p_trip_id bigint)
returns table (trip_id bigint, user_id uuid, first_name text, last_name text, email text, is_owner boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  owner_id uuid;
begin
  select t.user_id into owner_id from public.trips t where t.id = p_trip_id;
  if caller is null or owner_id is null or (
    caller <> owner_id and not exists (
      select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = caller
    )
  ) then
    raise exception 'Trip unavailable or access denied' using errcode = '42501';
  end if;
  return query
    select p_trip_id, p.id, p.first_name::text, p.last_name::text,
      case when caller = owner_id then p.email::text else null::text end,
      p.id = owner_id
    from public.profiles p
    where p.id = owner_id or exists (
      select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = p.id
    )
    order by (p.id = owner_id) desc, p.id;
end;
$$;
alter function public.trip_participant_display(bigint) owner to postgres;
revoke all on function public.trip_participant_display(bigint) from public, anon, authenticated, service_role;
grant execute on function public.trip_participant_display(bigint) to authenticated;
commit;
