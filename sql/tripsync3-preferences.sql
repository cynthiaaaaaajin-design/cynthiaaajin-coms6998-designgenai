-- One-time additive extension; preserves existing preference submissions and all itinerary history.
begin;
create function public.valid_activity_choices(value jsonb) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(value)='object' and not exists(select 1 from jsonb_each_text(case when jsonb_typeof(value)='object' then value else '{}' end) e where e.key not in ('museums','shopping','hiking','nightlife','beaches','food','history','art') or e.value is null or e.value not in ('must','nice','avoid'));
$$;
alter table public.trip_preferences
 add column activity_choices jsonb not null default '{}' check(public.valid_activity_choices(activity_choices)),
 add column dietary_restrictions text[] not null default '{}' check(public.collaboration_text_list(dietary_restrictions)),
 add column preferred_transportation text[] not null default '{}' check(public.collaboration_text_list(preferred_transportation)),
 add column availability_start date,
 add column availability_end date,
 add constraint valid_availability check((availability_start is null and availability_end is null) or (availability_start is not null and availability_end is not null and availability_end>=availability_start));
grant update(activity_choices,dietary_restrictions,preferred_transportation,availability_start,availability_end) on public.trip_preferences to authenticated;
create or replace function public.trip_preference_snapshot(p_trip_id bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.collaboration_participant(p_trip_id,auth.uid()) then raise exception 'Participant required' using errcode='42501';end if;
 select jsonb_build_object('participants',coalesce((select jsonb_agg(p.id order by p.id) from public.profiles p where public.collaboration_participant(p_trip_id,p.id)),'[]'::jsonb),
 'preferences',coalesce((select jsonb_agg(jsonb_build_object('user_id',p.user_id,'budget_amount',p.budget_amount,'budget_currency',p.budget_currency,'budget_scope',p.budget_scope,'budget_notes',p.budget_notes,'travel_pace',p.travel_pace,'must_visit_places',p.must_visit_places,'interests',p.interests,'hard_constraints',p.hard_constraints,'additional_notes',p.additional_notes,'activity_choices',p.activity_choices,'dietary_restrictions',p.dietary_restrictions,'preferred_transportation',p.preferred_transportation,'availability_start',p.availability_start,'availability_end',p.availability_end) order by p.user_id) from public.trip_preferences p where p.trip_id=p_trip_id and public.collaboration_participant(p_trip_id,p.user_id)),'[]'::jsonb)) into result;
 return result;
end;$$;
commit;
