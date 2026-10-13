-- Apply once in the Supabase SQL editor as postgres, before deploying the UI.
-- Existing trip/member/vote RLS policies are unchanged. No service-role key required.
begin;
create table public.trip_invitations (
  trip_id bigint primary key references public.trips(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
alter table public.trip_invitations enable row level security;
revoke all on public.trip_invitations from public, anon, authenticated;

create function public.manage_trip_invitation(p_trip_id bigint, p_hash text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); expiry timestamptz := now() + interval '7 days';
begin
  -- Serialize creation/revocation with acceptance and trip deletion.
  perform 1 from public.trips where id = p_trip_id and user_id = caller for update;
  if caller is null or not found then raise exception 'Owner required' using errcode = '42501'; end if;
  if p_hash is null then
    update public.trip_invitations set revoked_at = now() where trip_id = p_trip_id;
    return null;
  end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid token hash'; end if;
  insert into public.trip_invitations(trip_id, token_hash, created_by, expires_at)
    values(p_trip_id, p_hash, caller, expiry)
    on conflict(trip_id) do update set token_hash = excluded.token_hash, created_by = caller,
      expires_at = expiry, revoked_at = null;
  return expiry;
end;
$$;

create function public.accept_trip_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); invite public.trip_invitations%rowtype; owner_id uuid; target bigint;
begin
  if caller is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('result','invalid'); end if;
  select trip_id into target from public.trip_invitations
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if target is null then return jsonb_build_object('result','invalid'); end if;
  select user_id into owner_id from public.trips where id = target for update;
  select * into invite from public.trip_invitations where trip_id = target
    and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found or owner_id is null or invite.created_by <> owner_id or invite.revoked_at is not null
    or invite.expires_at <= now() then return jsonb_build_object('result','invalid'); end if;
  if caller = owner_id then return jsonb_build_object('result','already_member','tripId',target::text); end if;
  if not exists(select 1 from auth.users where id = caller and email_confirmed_at is not null) then
    return jsonb_build_object('result','unverified');
  end if;
  if not exists(select 1 from public.profiles where id = caller) then
    return jsonb_build_object('result','profile_missing');
  end if;
  if exists(select 1 from public.trip_members where trip_id = target and user_id = caller) then
    return jsonb_build_object('result','already_member','tripId',target::text);
  end if;
  insert into public.trip_members(trip_id,user_id) values(target,caller);
  return jsonb_build_object('result','joined','tripId',target::text);
end;
$$;
alter function public.manage_trip_invitation(bigint,text) owner to postgres;
alter function public.accept_trip_invitation(text) owner to postgres;
revoke all on function public.manage_trip_invitation(bigint,text) from public, anon, authenticated, service_role;
revoke all on function public.accept_trip_invitation(text) from public, anon, authenticated, service_role;
grant execute on function public.manage_trip_invitation(bigint,text) to authenticated;
grant execute on function public.accept_trip_invitation(text) to authenticated;
commit;
