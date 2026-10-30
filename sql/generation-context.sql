begin;
create or replace function public.link_observed_generation(p_id uuid,p_trip_id text,p_version_id uuid,p_operation text,p_scope text default null,p_day integer default null,p_item_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare r public.admin_resources;t public.trips;v public.itinerary_versions;ctx jsonb;
begin
 select * into r from public.admin_resources where id=p_id and resource='generation-requests' for update;
 if auth.uid() is null or r.id is null or r.data->>'user_id' is distinct from auth.uid()::text or r.data->>'status'<>'pending' or r.data?'generation_context' then raise exception 'Request unavailable' using errcode='42501'; end if;
 if p_operation not in ('initial','revision','repair') or p_scope not in ('trip','day','activity') or p_operation is null or p_scope is null then raise exception 'Invalid context' using errcode='22023';end if;
 if (p_operation='revision' and r.data->>'kind'<>'proposal') or (p_operation in ('initial','repair') and (r.data->>'kind'<>'itinerary' or p_scope<>'trip')) then raise exception 'Context kind mismatch' using errcode='22023';end if;
 if p_trip_id is null or p_trip_id !~ '^[0-9]{1,19}$' then raise exception 'Invalid trip' using errcode='22023';end if;
 select * into t from public.trips where id::text=p_trip_id;
 if t.id is null or not (t.user_id=auth.uid() or exists(select 1 from public.trip_members m where m.trip_id=t.id and m.user_id=auth.uid())) then raise exception 'Trip unavailable' using errcode='42501';end if;
 if p_operation in ('initial','repair') and t.user_id<>auth.uid() then raise exception 'Owner required' using errcode='42501';end if;
 select * into v from public.itinerary_versions where id=p_version_id and trip_id=t.id;
 if v.id is null then raise exception 'Version unavailable' using errcode='22023';end if;
 if (p_scope in ('day','activity') and (p_day is null or p_day<1 or p_day>30)) or (p_scope='activity' and not exists(select 1 from public.itinerary_items where id=p_item_id and version_id=v.id and day_number=p_day)) then raise exception 'Invalid scope' using errcode='22023';end if;
 ctx:=jsonb_build_object('trip_id',t.id::text,'trip_title',t.title,'destination',t.destination,'version_id',v.id,'version_number',v.version_number,'operation',p_operation,'scope',p_scope,'day',p_day,'item_id',p_item_id,'association_method','recorded_at_request');
 update public.admin_resources set data=data||jsonb_build_object('generation_context',ctx) where id=p_id;
end;$$;
revoke all on function public.link_observed_generation(uuid,text,uuid,text,text,integer,uuid) from public,anon;
grant execute on function public.link_observed_generation(uuid,text,uuid,text,text,integer,uuid) to authenticated;
create or replace function public.copy_generation_context() returns trigger language plpgsql security definer set search_path='' as $$
declare ctx jsonb;
begin
 if new.resource in ('llm-responses','generated-media') then
  select data->'generation_context' into ctx from public.admin_resources where resource='generation-requests' and id::text=new.data->>'request_id';
  if ctx is not null then new.data:=new.data||jsonb_build_object('generation_context',ctx);end if;
 end if;return new;
end;$$;
revoke all on function public.copy_generation_context() from public,anon,authenticated;
drop trigger if exists copy_generation_context on public.admin_resources;
create trigger copy_generation_context before insert on public.admin_resources for each row execute function public.copy_generation_context();
-- Historical associations use an exact saved response plus the same requesting
-- account. Multiple matches stay unknown; activity names are never used.
with candidates as (
 select r.id,jsonb_build_object('trip_id',t.id::text,'trip_title',t.title,'destination',t.destination,'version_id',v.id,'version_number',v.version_number,'operation',case when v.source='ai_initial' then 'initial' else 'repair' end,'scope','trip','association_method','exact_saved_response') ctx
 from public.admin_resources r join public.admin_resources reply on reply.resource='llm-responses' and reply.data->>'request_id'=r.id::text
 join public.itinerary_versions v on v.response_text=reply.data->>'response' join public.trips t on t.id=v.trip_id
 where r.resource='generation-requests' and not r.data?'generation_context' and r.data->>'kind'='itinerary' and v.created_by::text=r.data->>'user_id'
 union all
 select r.id,jsonb_build_object('trip_id',t.id::text,'trip_title',t.title,'destination',t.destination,'version_id',v.id,'version_number',v.version_number,'operation','revision','scope',p.scope,'day',p.target_day,'item_id',p.target_item_id,'association_method','exact_saved_response')
 from public.admin_resources r join public.admin_resources reply on reply.resource='llm-responses' and reply.data->>'request_id'=r.id::text
 join public.itinerary_proposals p on p.response_text=reply.data->>'response' join public.trips t on t.id=p.trip_id join public.itinerary_versions v on v.id=p.base_version_id
 where r.resource='generation-requests' and not r.data?'generation_context' and r.data->>'kind'='proposal' and p.created_by::text=r.data->>'user_id'
),unique_matches as (select id,(jsonb_agg(ctx)->0) ctx from candidates group by id having count(*)=1)
update public.admin_resources r set data=r.data||jsonb_build_object('generation_context',m.ctx) from unique_matches m where r.id=m.id;
update public.admin_resources child set data=child.data||jsonb_build_object('generation_context',parent.data->'generation_context') from public.admin_resources parent where child.resource in ('llm-responses','generated-media') and parent.resource='generation-requests' and parent.id::text=child.data->>'request_id' and parent.data?'generation_context' and not child.data?'generation_context';
commit;
