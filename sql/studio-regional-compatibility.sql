-- Backwards-compatible gateway for existing immutable Public deployments.
begin;
create or replace function public.studio_gateway(p_secret text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.studio_trip_runs;pub public.studio_chain_versions;t public.trips;v public.itinerary_versions;items jsonb;pid uuid;days integer;n integer;decision jsonb;enabled boolean;
begin
 if auth.uid() is null or p_secret is null or length(p_secret)<32 or not exists(select 1 from public.studio_integration_config where slot='trip-planning' and secret_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex')) then raise exception 'Server authorization required' using errcode='42501';end if;
 if p_data is null or octet_length(p_data::text)>1000000 then raise exception 'Invalid request';end if;
 if p_action='routing_context' then
  select * into t from public.trips where id=(p_data->>'trip_id')::bigint;
  if t.id is null or not public.collaboration_participant(t.id,auth.uid()) then raise exception 'Trip access required' using errcode='42501';end if;
  return jsonb_build_object('destination',t.destination,'enabled',(select routing_enabled from public.studio_integration_config where slot='trip-planning'));
 end if;
 if p_action='begin' then
  if coalesce(p_data->>'trip_id','') !~ '^[0-9]{1,19}$' or coalesce(p_data->>'operation','') not in ('initial','repair','revision') or coalesce(length(p_data->>'input'),0) not between 1 and 150000 then raise exception 'Invalid generation context';end if;
  select * into t from public.trips where id=(p_data->>'trip_id')::bigint;
  if t.id is null or not public.collaboration_participant(t.id,auth.uid()) or (p_data->>'operation'<>'revision' and t.user_id<>auth.uid()) then raise exception 'Trip access required' using errcode='42501';end if;
  select * into v from public.itinerary_versions where id=(p_data->>'version_id')::uuid and trip_id=t.id;
  if v.id is null then raise exception 'Itinerary unavailable';end if;
  if p_data->>'operation'<>'revision' and exists(select 1 from public.itinerary_items where version_id=v.id) then raise exception 'Itinerary already has activities';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,6998));
  update public.studio_trip_runs set status='failed',error='Run timed out',finished_at=now() where user_id=auth.uid() and status in ('running','ready') and created_at<now()-interval '10 minutes';
  if exists(select 1 from public.studio_trip_runs where user_id=auth.uid() and status in ('running','ready')) then raise exception 'A generation is already running';end if;
  perform pg_advisory_xact_lock(69982026);
  select routing_enabled into enabled from public.studio_integration_config where slot='trip-planning';
  if enabled then
   -- Older immutable Public deployments cannot send routing metadata. Preserve
   -- those clients through the explicit fallback, with honest attribution.
   if p_data->'resolution' is null or p_data->'resolution'='null'::jsonb then
    p_data:=jsonb_set(p_data,'{resolution}',jsonb_build_object('destination',t.destination,'status','unresolved','country_code',null,'source','none','reason','legacy_client_no_resolution'));
   end if;
   if p_data->'resolution'->>'destination' is distinct from t.destination then raise exception 'Destination changed; retry routing';end if;
   if coalesce(p_data->'resolution'->>'status','') not in ('resolved','unresolved') or coalesce(p_data->'resolution'->>'source','') not in ('reviewed_alias','google_places','none') then raise exception 'Server destination resolution required';end if;
   decision:=public.studio_select_route(p_data->'resolution');
   select * into pub from public.studio_chain_versions where id=(decision->>'publication_id')::uuid;
  else
   select p.* into pub from public.studio_chain_versions p join public.studio_integration_config c on c.active_version_id=p.id where c.slot='trip-planning';
  end if;
  if pub.id is null or pub.snapshot->>'output_contract'<>'itinerary' then raise exception 'Publish a tested Trip Planning Assistant in Chain Studio first';end if;
  insert into public.studio_trip_runs(publication_id,trip_id,version_id,base_version_id,user_id,operation,input,routing_decision)
  values(pub.id,t.id,case when p_data->>'operation'='revision' then null else v.id end,v.id,auth.uid(),p_data->>'operation',p_data->>'input',decision) returning * into r;
  return jsonb_build_object('id',r.id,'publication_id',pub.id,'version_number',pub.version_number,'snapshot',pub.snapshot,'routing_decision',decision);
 end if;
 select * into r from public.studio_trip_runs where id=(p_data->>'id')::uuid and user_id=auth.uid() for update;
 if r.id is null or r.status not in ('running','ready') then raise exception 'Run unavailable' using errcode='42501';end if;
 if not public.collaboration_participant(r.trip_id,auth.uid()) then raise exception 'Trip access revoked' using errcode='42501';end if;
 if p_action='fail' then
  update public.studio_trip_runs set status='failed',error=left(coalesce(p_data->>'error','Generation failed'),1000),finished_at=now() where id=r.id;
  return jsonb_build_object('id',r.id);
 elsif p_action='step' then
  select * into pub from public.studio_chain_versions where id=r.publication_id;
  n:=jsonb_array_length(r.outputs)+1;
  if r.status<>'running' or (p_data->>'step')::integer<>n or coalesce(length(p_data->>'text'),0) not between 1 and 60000 or n>jsonb_array_length(pub.snapshot->'steps') then raise exception 'Invalid step output';end if;
  update public.studio_trip_runs set outputs=outputs||jsonb_build_array(jsonb_build_object('step',n,'text',p_data->>'text','model',left(p_data->>'model',200),'prompt',p_data->>'prompt','duration_ms',greatest(0,(p_data->>'duration_ms')::integer))),status=case when n=jsonb_array_length(pub.snapshot->'steps') then 'ready' else 'running' end where id=r.id;
  return jsonb_build_object('id',r.id);
 elsif p_action='finish' then
  if r.status<>'ready' or r.operation='revision' then raise exception 'Run is not ready';end if;
  select * into t from public.trips where id=r.trip_id for update;
  if t.user_id<>auth.uid() then raise exception 'Owner required' using errcode='42501';end if;
  select * into v from public.itinerary_versions where id=r.version_id for update;
  if exists(select 1 from public.itinerary_items where version_id=v.id) then raise exception 'Itinerary already saved' using errcode='40001';end if;
  days:=t.end_date-t.start_date+1;
  items:=public.community_clean_activities((r.outputs->-1->>'text')::jsonb->'activities',days);
  perform public.validate_trip_draft(t.id,v.id,items);
  update public.itinerary_versions set response_text=r.outputs->-1->>'text' where id=v.id;
  insert into public.itinerary_items(version_id,day_number,position,start_time,title,description,location,origin)
  select v.id,(a->>'day_number')::integer,(a->>'position')::integer,(a->>'start_time')::time,a->>'title',a->>'description',a->>'location','ai' from jsonb_array_elements(items) a;
  update public.studio_trip_runs set status='completed',finished_at=now() where id=r.id;
  return jsonb_build_object('version_id',v.id);
 elsif p_action='proposal' then
  if r.status<>'ready' or r.operation<>'revision' then raise exception 'Run is not a ready proposal';end if;
  pid:=public.save_itinerary_proposal(r.trip_id,r.base_version_id,p_data->>'scope',(p_data->>'day')::integer,(p_data->>'item_id')::uuid,p_data->>'instruction',r.input,r.outputs->-1->>'text',p_data->'snapshot',p_data->'trip_context');
  update public.studio_trip_runs set proposal_id=pid,status='completed',finished_at=now() where id=r.id;
  return jsonb_build_object('proposal_id',pid);
 end if;
 raise exception 'Unsupported gateway action';
end;$$;
commit;
