-- Phase 3: run once after trip-collaboration.sql as postgres. No historical rows rewritten.
begin;
alter table public.itinerary_versions add column preference_snapshot jsonb;

create function public.trip_preference_snapshot(p_trip_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.collaboration_participant(p_trip_id,auth.uid()) then raise exception 'Participant required' using errcode='42501'; end if;
 select jsonb_build_object(
 'participants', coalesce((select jsonb_agg(p.id order by p.id) from public.profiles p where public.collaboration_participant(p_trip_id,p.id)),'[]'::jsonb),
 'preferences', coalesce((select jsonb_agg(jsonb_build_object(
 'user_id',p.user_id,'budget_amount',p.budget_amount,'budget_currency',p.budget_currency,'budget_scope',p.budget_scope,
 'budget_notes',p.budget_notes,'travel_pace',p.travel_pace,'must_visit_places',p.must_visit_places,'interests',p.interests,
 'hard_constraints',p.hard_constraints,'additional_notes',p.additional_notes) order by p.user_id)
 from public.trip_preferences p where p.trip_id=p_trip_id and public.collaboration_participant(p_trip_id,p.user_id)),'[]'::jsonb)) into result;
 return result;
end;
$$;
revoke all on function public.trip_preference_snapshot(bigint) from public,anon;
grant execute on function public.trip_preference_snapshot(bigint) to authenticated;

-- Validate both API and direct RPC input; activity order is explicit, contiguous per day.
create function public.validate_trip_draft(p_trip bigint,p_base uuid,p_items jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare days integer; a jsonb; d integer; pos integer; previous_day integer:=0; previous_pos integer:=-1; seen uuid[]:='{}'; sid uuid;
begin
 select (end_date-start_date)+1 into days from public.trips where id=p_trip;
 if days is null or days<1 or days>30 or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Invalid draft or dates' using errcode='22023'; end if;
 if jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>120 then raise exception 'Use 1 to 120 activities' using errcode='22023'; end if;
 for a in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(a) <> 'object' or jsonb_typeof(a->'day_number') is distinct from 'number' or jsonb_typeof(a->'position') is distinct from 'number' or
   (a->>'day_number') !~ '^[0-9]+$' or (a->>'position') !~ '^[0-9]+$' then raise exception 'Invalid day or position' using errcode='22023'; end if;
  d:=(a->>'day_number')::integer; pos:=(a->>'position')::integer;
  if d<1 or d>days or d<previous_day or pos<>(case when d=previous_day then previous_pos+1 else 0 end) then raise exception 'Invalid activity ordering' using errcode='22023'; end if;
  if jsonb_typeof(a->'title') is distinct from 'string' or length(trim(a->>'title')) not between 1 and 200 or
   not (a ? 'start_time' and a ? 'location' and a ? 'description') or
   (a->'start_time'<>'null'::jsonb and (jsonb_typeof(a->'start_time')<>'string' or (a->>'start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) or
   (a->'location'<>'null'::jsonb and (jsonb_typeof(a->'location')<>'string' or length(a->>'location')>2000)) or
   (a->'description'<>'null'::jsonb and (jsonb_typeof(a->'description')<>'string' or length(a->>'description')>2000)) then raise exception 'Invalid activity fields' using errcode='22023'; end if;
  if a->>'source_item_id' is not null then
   sid:=(a->>'source_item_id')::uuid;
   if sid=any(seen) or not exists(select 1 from public.itinerary_items where id=sid and version_id=p_base) then raise exception 'Invalid source item' using errcode='22023'; end if;
   seen:=array_append(seen,sid);
  end if;
  previous_day:=d; previous_pos:=pos;
 end loop;
end;
$$;
revoke all on function public.validate_trip_draft(bigint,uuid,jsonb) from public,anon,authenticated;

create table public.itinerary_proposals (
 id uuid primary key default gen_random_uuid(), trip_id bigint not null references public.trips(id) on delete cascade,
 base_version_id uuid not null, created_by uuid not null references public.profiles(id),
 scope text not null check(scope in ('activity','day','trip')), target_day integer, target_item_id uuid,
 instruction text not null check(length(instruction) between 1 and 2000),
 prompt_text text not null check(length(prompt_text) between 1 and 2000000),
 response_text text not null check(length(response_text) between 1 and 1000000),
 preference_snapshot jsonb not null, trip_context jsonb not null,
 created_at timestamptz not null default now(), applied_version_id uuid references public.itinerary_versions(id),
 foreign key(base_version_id,trip_id) references public.itinerary_versions(id,trip_id),
 foreign key(target_item_id,base_version_id) references public.itinerary_items(id,version_id),
 check((scope='activity' and target_item_id is not null and target_day is not null) or
       (scope='day' and target_day is not null and target_item_id is null) or
       (scope='trip' and target_day is null and target_item_id is null))
);
create index itinerary_proposals_trip on public.itinerary_proposals(trip_id,created_at);
alter table public.itinerary_proposals enable row level security;
revoke all on public.itinerary_proposals from public,anon,authenticated;
grant select on public.itinerary_proposals to authenticated;
create policy proposals_read on public.itinerary_proposals for select to authenticated using(public.collaboration_participant(trip_id,auth.uid()));

-- No new direct INSERT/UPDATE grants on versions/items. Participants publish only through checked RPCs.
create function public.publish_trip_draft(p_trip bigint,p_base uuid,p_items jsonb,p_proposal uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare latest public.itinerary_versions%rowtype; owner_id uuid; new_id uuid; a jsonb; old_item public.itinerary_items%rowtype;
 proposal public.itinerary_proposals%rowtype; origin_value public.itinerary_items.origin%type; version_source public.itinerary_versions.source%type:='manual'; snapshot jsonb;
begin
 select user_id into owner_id from public.trips where id=p_trip for update;
 if not public.collaboration_participant(p_trip,auth.uid()) then raise exception 'Participant required' using errcode='42501'; end if;
 if p_proposal is not null and auth.uid()<>owner_id then raise exception 'Only the owner can apply AI proposals' using errcode='42501'; end if;
 -- Membership writes and publications share a trip-row lock.
 -- Membership writes share the trip lock via publication_input_lock.
 select * into latest from public.itinerary_versions where trip_id=p_trip and exists(select 1 from public.itinerary_items i where i.version_id=itinerary_versions.id) order by version_number desc limit 1;
 if latest.id is null or latest.id is distinct from p_base then raise exception 'This itinerary has been updated by another traveler. Please review the latest version before applying your changes.' using errcode='40001'; end if;
 if p_proposal is not null then
  if auth.uid()<>owner_id then raise exception 'Only the owner can apply AI proposals' using errcode='42501'; end if;
  select * into proposal from public.itinerary_proposals where id=p_proposal and trip_id=p_trip and base_version_id=p_base and applied_version_id is null for update;
  if not found then raise exception 'Proposal unavailable' using errcode='40001'; end if;
  if proposal.trip_context is distinct from (select jsonb_build_object('destination',destination,'start_date',start_date,'end_date',end_date) from public.trips where id=p_trip)
    or proposal.preference_snapshot is distinct from public.trip_preference_snapshot(p_trip) then raise exception 'Group preferences or trip details have changed since this preview. Please generate a refreshed proposal before applying changes.' using errcode='P3001'; end if;
  version_source:='ai_revision'; snapshot:=proposal.preference_snapshot;
 end if;
 perform public.validate_trip_draft(p_trip,p_base,p_items);
 insert into public.itinerary_versions(trip_id,version_number,parent_version_id,created_by,source,prompt_text,response_text,preference_snapshot)
 values(p_trip,(select coalesce(max(version_number),0)+1 from public.itinerary_versions where trip_id=p_trip),p_base,auth.uid(),version_source,proposal.prompt_text,proposal.response_text,snapshot) returning id into new_id;
 for a in select value from jsonb_array_elements(p_items) loop
  origin_value:=case when p_proposal is null then 'manual' else 'ai' end;
  if a->>'source_item_id' is not null then
   select * into old_item from public.itinerary_items where id=(a->>'source_item_id')::uuid and version_id=p_base;
   if (old_item.title,old_item.description,old_item.location,left(old_item.start_time::text,5)) is not distinct from
      (a->>'title',a->>'description',a->>'location',a->>'start_time') then origin_value:=old_item.origin; end if;
  end if;
  insert into public.itinerary_items(version_id,day_number,position,start_time,title,description,location,origin)
  values(new_id,(a->>'day_number')::integer,(a->>'position')::integer,(a->>'start_time')::time,trim(a->>'title'),a->>'description',a->>'location',origin_value);
 end loop;
 if p_proposal is not null then update public.itinerary_proposals set applied_version_id=new_id where id=p_proposal; end if;
 return new_id;
end;
$$;
revoke all on function public.publish_trip_draft(bigint,uuid,jsonb,uuid) from public,anon,authenticated;
create function public.save_manual_itinerary(p_trip_id bigint,p_base_version_id uuid,p_activities jsonb) returns uuid
language sql security definer set search_path='' as $$ select public.publish_trip_draft(p_trip_id,p_base_version_id,p_activities,null); $$;
revoke all on function public.save_manual_itinerary(bigint,uuid,jsonb) from public,anon;
grant execute on function public.save_manual_itinerary(bigint,uuid,jsonb) to authenticated;

-- Proposals remain separate from published history and are immutable once stored.
create function public.save_itinerary_proposal(p_trip_id bigint,p_base_version_id uuid,p_scope text,p_target_day integer,p_target_item_id uuid,p_instruction text,p_prompt text,p_response text,p_snapshot jsonb,p_trip_context jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare proposal_id uuid; body jsonb; rows jsonb; a jsonb; latest uuid;
begin
 perform 1 from public.trips where id=p_trip_id for update;
 if not public.collaboration_participant(p_trip_id,auth.uid()) then raise exception 'Participant required' using errcode='42501'; end if;
 if p_scope='trip' and not exists(select 1 from public.trips where id=p_trip_id and user_id=auth.uid()) then raise exception 'Owner required for full regeneration' using errcode='42501'; end if;
 select id into latest from public.itinerary_versions where trip_id=p_trip_id and exists(select 1 from public.itinerary_items i where i.version_id=itinerary_versions.id) order by version_number desc limit 1;
 if latest is distinct from p_base_version_id then raise exception 'This itinerary has been updated by another traveler. Please review the latest version before applying your changes.' using errcode='40001'; end if;
 if p_snapshot is distinct from public.trip_preference_snapshot(p_trip_id) or p_trip_context is distinct from
 (select jsonb_build_object('destination',destination,'start_date',start_date,'end_date',end_date) from public.trips where id=p_trip_id) then raise exception 'Group preferences or trip details have changed since this preview. Please generate a refreshed proposal before applying changes.' using errcode='P3001'; end if;
 body:=p_response::jsonb; rows:=body->'activities';
 if jsonb_typeof(body->'explanation') is distinct from 'string' or length(body->>'explanation') not between 1 and 4000 or
 jsonb_typeof(body->'uncertainties') is distinct from 'array' or jsonb_array_length(body->'uncertainties')>20 then raise exception 'Invalid proposal explanation' using errcode='22023'; end if;
 for a in select value from jsonb_array_elements(body->'uncertainties') loop
  if jsonb_typeof(a)<>'string' or length(a#>>'{}')>1000 then raise exception 'Invalid uncertainty' using errcode='22023'; end if;
 end loop;
 perform public.validate_trip_draft(p_trip_id,p_base_version_id,rows);
 if exists(select 1 from jsonb_array_elements(rows) x where x->>'source_item_id' is not null) then raise exception 'AI replacements cannot reuse item identities' using errcode='22023'; end if;
 if p_scope in ('activity','day') and exists(select 1 from jsonb_array_elements(rows) x where (x->>'day_number')::integer<>p_target_day) then raise exception 'Proposal exceeds selected day' using errcode='22023'; end if;
 if p_scope='activity' and (jsonb_array_length(rows)<>1 or not exists(select 1 from public.itinerary_items where id=p_target_item_id and version_id=p_base_version_id and day_number=p_target_day)) then raise exception 'Invalid target activity' using errcode='22023'; end if;
 if p_scope='trip' and (select count(distinct (x->>'day_number')::integer) from jsonb_array_elements(rows) x)<>(select end_date-start_date+1 from public.trips where id=p_trip_id) then raise exception 'Full proposal must cover every day' using errcode='22023'; end if;
 insert into public.itinerary_proposals(trip_id,base_version_id,created_by,scope,target_day,target_item_id,instruction,prompt_text,response_text,preference_snapshot,trip_context)
 values(p_trip_id,p_base_version_id,auth.uid(),p_scope,p_target_day,p_target_item_id,p_instruction,p_prompt,p_response,p_snapshot,p_trip_context) returning id into proposal_id;
 return proposal_id;
end;
$$;
revoke all on function public.save_itinerary_proposal(bigint,uuid,text,integer,uuid,text,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_itinerary_proposal(bigint,uuid,text,integer,uuid,text,text,text,jsonb,jsonb) to authenticated;

create function public.apply_itinerary_proposal(p_trip_id bigint,p_proposal_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.itinerary_proposals%rowtype; merged jsonb;
begin
 select * into p from public.itinerary_proposals where id=p_proposal_id and trip_id=p_trip_id;
 if not found then raise exception 'Proposal unavailable' using errcode='42501'; end if;
 -- Merge on the database, never from an owner-supplied modified preview. Unselected rows copied exactly.
 with originals as (
  select jsonb_build_object('source_item_id',i.id,'day_number',i.day_number,'position',i.position,'start_time',left(i.start_time::text,5),'title',i.title,'description',i.description,'location',i.location) a,
  i.day_number d,i.position pos from public.itinerary_items i where i.version_id=p.base_version_id and
  (p.scope='activity' and i.id<>p.target_item_id or p.scope='day' and i.day_number<>p.target_day)
 ), replacements as (
  select x a,(x->>'day_number')::integer d,case when p.scope='activity' then (select position from public.itinerary_items where id=p.target_item_id) else (x->>'position')::integer end pos
  from jsonb_array_elements(p.response_text::jsonb->'activities') x
 ), ordered as (
  select a,d,pos from (select * from originals union all select * from replacements) s
 ) select jsonb_agg(a || jsonb_build_object('position',pos) order by d,pos) into merged from ordered;
 return public.publish_trip_draft(p_trip_id,p.base_version_id,merged,p.id);
end;
$$;
revoke all on function public.apply_itinerary_proposal(bigint,uuid) from public,anon;
grant execute on function public.apply_itinerary_proposal(bigint,uuid) to authenticated;

-- Every writer of publication inputs takes the same lock as the atomic publisher.
-- The row lock lasts until transaction commit, preventing preference/membership changes
-- from committing between snapshot validation and publication.
create or replace function public.publication_input_lock() returns trigger
language plpgsql security definer set search_path='' as $$
declare first_trip bigint; second_trip bigint;
begin
 if TG_TABLE_NAME='itinerary_items' then
  select trip_id into first_trip from public.itinerary_versions where id=new.version_id;
 elsif TG_OP='INSERT' then first_trip:=new.trip_id;
 elsif TG_OP='DELETE' then first_trip:=old.trip_id;
 else first_trip:=least(old.trip_id,new.trip_id);second_trip:=greatest(old.trip_id,new.trip_id);
 end if;
 perform 1 from public.trips where id=first_trip for update;
 if second_trip is distinct from first_trip then perform 1 from public.trips where id=second_trip for update; end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function public.publication_input_lock() from public,anon,authenticated;
drop trigger if exists publication_input_lock on public.trip_preferences;
create trigger publication_input_lock before insert or update or delete on public.trip_preferences for each row execute function public.publication_input_lock();
drop trigger if exists publication_input_lock on public.trip_members;
create trigger publication_input_lock before insert or update or delete on public.trip_members for each row execute function public.publication_input_lock();
drop trigger if exists publication_input_lock on public.itinerary_items;
create trigger publication_input_lock before insert on public.itinerary_items for each row execute function public.publication_input_lock();

create or replace function public.current_published_itinerary(p_trip_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.collaboration_participant(p_trip_id,auth.uid()) then raise exception 'Participant required' using errcode='42501'; end if;
 return (select jsonb_build_object('id',v.id,'version_number',v.version_number) from public.itinerary_versions v
 where v.trip_id=p_trip_id and exists(select 1 from public.itinerary_items i where i.version_id=v.id)
 order by v.version_number desc limit 1);
end;
$$;
revoke all on function public.current_published_itinerary(bigint) from public,anon;
grant execute on function public.current_published_itinerary(bigint) to authenticated;

create or replace function public.collaboration_request_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
   -- Serialize against new version FK inserts and invitation membership changes.
   perform 1 from public.trips where id=new.trip_id for update;
   if not public.collaboration_participant(new.trip_id,auth.uid()) or new.created_by is distinct from auth.uid() then
     raise exception 'Participant required' using errcode='42501';
   end if;
   if new.version_id is distinct from ((public.current_published_itinerary(new.trip_id)->>'id')::uuid) then
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
revoke all on function public.collaboration_request_guard() from public,anon,authenticated;
drop policy if exists requests_insert on public.activity_change_requests;
create policy requests_insert on public.activity_change_requests for insert to authenticated
 with check(created_by=auth.uid() and status='pending' and public.collaboration_participant(trip_id,auth.uid())
 and version_id=((public.current_published_itinerary(trip_id)->>'id')::uuid));

commit;
