-- Phase 1 + 2. Run once as postgres in the intended Supabase project's SQL editor.
-- Requires existing trips(bigint), profiles(uuid), trip_members,
-- itinerary_versions(uuid), itinerary_items(uuid). Existing RLS is unchanged.
begin;

create function public.collaboration_participant(p_trip bigint, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists(select 1 from public.trips t where t.id=p_trip
    and (t.user_id=auth.uid() or exists(select 1 from public.trip_members m where m.trip_id=t.id and m.user_id=auth.uid()))
    and (t.user_id=p_user or exists(select 1 from public.trip_members m where m.trip_id=t.id and m.user_id=p_user)));
$$;
revoke all on function public.collaboration_participant(bigint,uuid) from public, anon;
grant execute on function public.collaboration_participant(bigint,uuid) to authenticated;

create function public.collaboration_people(p_trip_id bigint)
returns table(user_id uuid, name text) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.collaboration_participant(p_trip_id, auth.uid()) then
    raise exception 'Trip access denied' using errcode='42501';
  end if;
  return query select p.id, nullif(trim(concat_ws(' ',p.first_name,p.last_name)), '')
    from public.profiles p where public.collaboration_participant(p_trip_id,p.id) order by p.id;
end;
$$;
revoke all on function public.collaboration_people(bigint) from public, anon;
grant execute on function public.collaboration_people(bigint) to authenticated;

create function public.collaboration_text_list(value text[]) returns boolean
language sql immutable set search_path = '' as $$
 select cardinality(value) <= 30 and not exists(select 1 from unnest(value) s where s is null or length(trim(s))=0 or length(s)>300);
$$;
create table public.trip_preferences (
 id uuid primary key default gen_random_uuid(),
 trip_id bigint not null references public.trips(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 budget_amount numeric check (budget_amount >= 0 and budget_amount <= 1000000000),
 budget_currency text not null check (budget_currency ~ '^[A-Z]{3}$'),
 budget_scope text not null check (budget_scope in ('per_person_total','per_person_day')),
 budget_notes text check (length(budget_notes)<=2000),
 travel_pace text not null check (travel_pace in ('relaxed','balanced','packed')),
 must_visit_places text[] not null default '{}' check (public.collaboration_text_list(must_visit_places)),
 interests text[] not null default '{}' check (public.collaboration_text_list(interests)),
 hard_constraints text[] not null default '{}' check (public.collaboration_text_list(hard_constraints)),
 additional_notes text check (length(additional_notes)<=2000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(trip_id,user_id)
);
alter table public.trip_preferences enable row level security;
revoke all on public.trip_preferences from public, anon, authenticated;
grant select, insert on public.trip_preferences to authenticated;
grant update(budget_amount,budget_currency,budget_scope,budget_notes,travel_pace,must_visit_places,interests,hard_constraints,additional_notes,trip_id,user_id) on public.trip_preferences to authenticated;
create policy preferences_read on public.trip_preferences for select to authenticated
 using(public.collaboration_participant(trip_id,auth.uid()) and public.collaboration_participant(trip_id,user_id));
create policy preferences_insert on public.trip_preferences for insert to authenticated
 with check(user_id=auth.uid() and public.collaboration_participant(trip_id,auth.uid()));
create policy preferences_update on public.trip_preferences for update to authenticated
 using(user_id=auth.uid() and public.collaboration_participant(trip_id,auth.uid()))
 with check(user_id=auth.uid() and public.collaboration_participant(trip_id,auth.uid()));
create function public.collaboration_preferences_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' and (new.id,new.trip_id,new.user_id,new.created_at) is distinct from (old.id,old.trip_id,old.user_id,old.created_at) then
   raise exception 'Preference identity is immutable' using errcode='42501';
 end if;
 new.updated_at=now();
 return new;
end;
$$;
create trigger preferences_guard before insert or update on public.trip_preferences for each row execute function public.collaboration_preferences_guard();

-- Composite foreign keys enforce associations even for direct database writes.
alter table public.itinerary_versions add constraint collaboration_version_trip unique(id,trip_id);
alter table public.itinerary_items add constraint collaboration_item_version unique(id,version_id);
create table public.activity_change_requests (
 id uuid primary key default gen_random_uuid(),
 trip_id bigint not null references public.trips(id) on delete cascade,
 version_id uuid not null,
 item_id uuid not null,
 created_by uuid not null references public.profiles(id),
 request_type text not null check(request_type in ('general','schedule','too_expensive','too_tiring','not_interested','replacement','other')),
 reason text check(length(reason)<=300),
 comment text check(length(comment)<=2000),
 suggested_replacement text check(length(suggested_replacement)<=2000),
 status text not null default 'pending' check(status in ('pending','resolved','declined')),
 resolved_by uuid references public.profiles(id), resolved_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(version_id,trip_id) references public.itinerary_versions(id,trip_id) on delete cascade,
 foreign key(item_id,version_id) references public.itinerary_items(id,version_id) on delete cascade,
 check(request_type <> 'replacement' or length(trim(suggested_replacement))>0 and suggested_replacement is not null),
 check((status='pending' and resolved_by is null and resolved_at is null) or (status<>'pending' and resolved_by is not null and resolved_at is not null))
);
create index collaboration_request_version on public.activity_change_requests(trip_id,version_id,id);
alter table public.activity_change_requests enable row level security;
revoke all on public.activity_change_requests from public, anon, authenticated;
grant select on public.activity_change_requests to authenticated;
grant insert(trip_id,version_id,item_id,created_by,request_type,reason,comment,suggested_replacement) on public.activity_change_requests to authenticated;
grant update(status) on public.activity_change_requests to authenticated;
create policy requests_read on public.activity_change_requests for select to authenticated
 using(public.collaboration_participant(trip_id,auth.uid()));
create policy requests_insert on public.activity_change_requests for insert to authenticated
 with check(created_by=auth.uid() and status='pending' and public.collaboration_participant(trip_id,auth.uid())
 and version_id=(select v.id from public.itinerary_versions v where v.trip_id=activity_change_requests.trip_id order by v.version_number desc limit 1));
create policy requests_resolve on public.activity_change_requests for update to authenticated
 using(status='pending' and exists(select 1 from public.trips t where t.id=trip_id and t.user_id=auth.uid()))
 with check(status in ('resolved','declined') and exists(select 1 from public.trips t where t.id=trip_id and t.user_id=auth.uid()));
create function public.collaboration_request_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
   -- Serialize against new version FK inserts and invitation membership changes.
   perform 1 from public.trips where id=new.trip_id for update;
   if not public.collaboration_participant(new.trip_id,auth.uid()) or new.created_by is distinct from auth.uid() then
     raise exception 'Participant required' using errcode='42501';
   end if;
   if new.version_id is distinct from (select id from public.itinerary_versions where trip_id=new.trip_id order by version_number desc limit 1) then
     raise exception 'Current version required' using errcode='23514';
   end if;
   new.status='pending'; new.resolved_by=null; new.resolved_at=null;
 else
   if not exists(select 1 from public.trips where id=old.trip_id and user_id=auth.uid()) or old.status<>'pending' or new.status not in ('resolved','declined') then
     raise exception 'Owner and pending suggestion required' using errcode='42501';
   end if;
   if (to_jsonb(new)-array['status','resolved_by','resolved_at','updated_at']) is distinct from
      (to_jsonb(old)-array['status','resolved_by','resolved_at','updated_at']) then
     raise exception 'Suggestion content is immutable' using errcode='42501';
   end if;
   new.resolved_by=auth.uid(); new.resolved_at=now();
 end if;
 new.updated_at=now(); return new;
end;
$$;
create trigger requests_guard before insert or update on public.activity_change_requests for each row execute function public.collaboration_request_guard();
revoke all on function public.collaboration_preferences_guard(), public.collaboration_request_guard() from public, anon, authenticated;
commit;
