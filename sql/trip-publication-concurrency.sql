-- Run after Phase 3 if already installed. Safe to rerun; no historical data changes.
begin;
create or replace function public.publish_trip_draft(p_trip bigint,p_base uuid,p_items jsonb,p_proposal uuid default null) returns uuid
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

create or replace function public.save_itinerary_proposal(p_trip_id bigint,p_base_version_id uuid,p_scope text,p_target_day integer,p_target_item_id uuid,p_instruction text,p_prompt text,p_response text,p_snapshot jsonb,p_trip_context jsonb) returns uuid
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
