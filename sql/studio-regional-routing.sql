-- Additive regional routing. Keeps legacy global pointer and all historical IDs.
begin;
alter table public.studio_integration_config add column routing_enabled boolean not null default false;
alter table public.studio_trip_runs add column routing_decision jsonb;
create table public.studio_chain_heads (
 chain_id uuid primary key references public.studio_chains(id),
 publication_id uuid not null references public.studio_chain_versions(id),
 updated_at timestamptz not null default now()
);
create table public.studio_routing_rules (
 id uuid primary key default gen_random_uuid(), rule_key text unique,
 name text not null check(length(name) between 1 and 80),
 country_codes text[] not null default '{}', priority integer not null check(priority between 1 and 9999),
 is_fallback boolean not null default false, enabled boolean not null default false,
 chain_id uuid references public.studio_chains(id),
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
 check((is_fallback and cardinality(country_codes)=0) or (not is_fallback and cardinality(country_codes)>0))
);
create unique index studio_one_fallback on public.studio_routing_rules(is_fallback) where is_fallback;
create unique index studio_route_priority on public.studio_routing_rules(priority) where enabled and not is_fallback;
alter table public.studio_chain_heads enable row level security;
alter table public.studio_routing_rules enable row level security;
revoke all on public.studio_chain_heads,public.studio_routing_rules from public,anon,authenticated;
grant select on public.studio_chain_heads,public.studio_routing_rules to authenticated;
create policy studio_heads_admin on public.studio_chain_heads for select to authenticated using(public.is_superadmin());
create policy studio_routes_admin on public.studio_routing_rules for select to authenticated using(public.is_superadmin());
insert into public.studio_chain_heads(chain_id,publication_id)
 select p.chain_id,p.id from public.studio_chain_versions p join public.studio_integration_config c on c.active_version_id=p.id where p.chain_id is not null;
insert into public.studio_routing_rules(rule_key,name,priority,is_fallback,enabled,chain_id)
 select 'global','Global fallback',9999,true,true,p.chain_id from public.studio_integration_config c left join public.studio_chain_versions p on p.id=c.active_version_id;
insert into public.studio_routing_rules(rule_key,name,country_codes,priority) values
 ('north-america','North America (CA, US, MX)',array['CA','US','MX'],20),
 ('europe','Europe',array['AD','AL','AT','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV','MC','MD','ME','MK','MT','NL','NO','PL','PT','RO','RS','SE','SI','SK','SM','UA','VA'],30),
 ('china','Mainland China',array['CN'],10);

-- No client calls this directly. Both preview and generation share this selector.
create function public.studio_select_route(p_resolution jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare matched public.studio_routing_rules; chosen public.studio_routing_rules; pub public.studio_chain_versions; reason text; country text;
begin
 country:=case when p_resolution->>'status'='resolved' then p_resolution->>'country_code' else null end;
 select * into matched from public.studio_routing_rules where enabled and not is_fallback and country=any(country_codes) order by priority,id limit 1;
 chosen:=matched;
 if matched.id is not null then
  select p.* into pub from public.studio_chain_heads h join public.studio_chain_versions p on p.id=h.publication_id and p.chain_id=h.chain_id where h.chain_id=matched.chain_id and p.snapshot->>'output_contract'='itinerary';
 end if;
 if pub.id is null then
  reason:=case when matched.id is not null then 'regional_publication_missing' when country is null then coalesce(p_resolution->>'reason','unresolved_destination') else 'no_country_rule' end;
  select * into chosen from public.studio_routing_rules where is_fallback and enabled;
  select p.* into pub from public.studio_chain_heads h join public.studio_chain_versions p on p.id=h.publication_id and p.chain_id=h.chain_id where h.chain_id=chosen.chain_id and p.snapshot->>'output_contract'='itinerary';
 end if;
 if pub.id is null then raise exception 'No valid global fallback publication is configured';end if;
 return jsonb_build_object('schema_version',1,'destination',p_resolution->>'destination','resolution',p_resolution,'country_code',country,
  'matched_rule_id',matched.id,'matched_rule',matched.name,'priority',matched.priority,
  'selected_rule_id',chosen.id,'selected_rule',chosen.name,'chain_id',pub.chain_id,'chain_name',pub.snapshot->>'name',
  'publication_id',pub.id,'version_number',pub.version_number,'fallback',reason is not null,'fallback_reason',reason,'selected_at',statement_timestamp());
end;$$;
revoke all on function public.studio_select_route(jsonb) from public,anon,authenticated;

create function public.studio_routing_preview(p_resolution jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.is_superadmin() is distinct from true then raise exception 'Superadmin required' using errcode='42501';end if;
 return public.studio_select_route(p_resolution);
end;$$;

create function public.studio_routing_config(p_rule jsonb default null,p_enabled boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare codes text[];r public.studio_routing_rules;
begin
 if public.is_superadmin() is distinct from true then raise exception 'Superadmin required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(69982026);
 if p_rule is not null then
  if octet_length(p_rule::text)>6000 then raise exception 'Rule too large';end if;
  select * into r from public.studio_routing_rules where id=(p_rule->>'id')::uuid for update;
  if r.id is null then raise exception 'Rule not found';end if;
  select coalesce(array_agg(distinct upper(trim(x)) order by upper(trim(x))),'{}') into codes from jsonb_array_elements_text(p_rule->'country_codes') x;
  if exists(select 1 from unnest(codes) code where code !~ '^[A-Z]{2}$' or not (code=any(string_to_array('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW',' ')))) then raise exception 'Use valid ISO alpha-2 country codes';end if;
  if r.is_fallback and (cardinality(codes)>0 or (p_rule->>'enabled')::boolean is distinct from true) then raise exception 'The explicit global fallback must remain enabled';end if;
  if p_rule->>'chain_id' is not null and not exists(select 1 from public.studio_chains where id=(p_rule->>'chain_id')::uuid and output_contract='itinerary') then raise exception 'Assign an itinerary chain';end if;
  update public.studio_routing_rules set name=trim(p_rule->>'name'),country_codes=codes,priority=(p_rule->>'priority')::integer,
   chain_id=(p_rule->>'chain_id')::uuid,enabled=(p_rule->>'enabled')::boolean,updated_by=auth.uid(),updated_at=clock_timestamp() where id=r.id;
 end if;
 if p_enabled is true then perform public.studio_select_route('{"status":"unresolved","reason":"configuration_check"}');end if;
 if p_enabled is not null then update public.studio_integration_config set routing_enabled=p_enabled where slot='trip-planning';end if;
 -- An edit may not invalidate the fallback while live routing is on.
 if exists(select 1 from public.studio_integration_config where routing_enabled) then perform public.studio_select_route('{"status":"unresolved","reason":"configuration_check"}');end if;
 return jsonb_build_object('enabled',(select routing_enabled from public.studio_integration_config where slot='trip-planning'),
 'rules',(select jsonb_agg(to_jsonb(x) order by priority) from public.studio_routing_rules x),
 'heads',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.studio_chain_heads x));
end;$$;

create function public.studio_publish_regional_chain(p_chain uuid,p_revision integer,p_run uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.studio_chains;r public.studio_runs;v uuid;n integer;days integer;
begin
 if public.is_superadmin() is distinct from true then raise exception 'Superadmin required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(69982026);
 select * into c from public.studio_chains where id=p_chain and revision=p_revision for update;
 if c.id is null or c.output_contract<>'itinerary' then raise exception 'Save a trip-planning chain first';end if;
 select * into r from public.studio_runs where id=p_run and chain_id=c.id and user_id=auth.uid() and status='completed';
 if r.id is null or r.snapshot->>'revision'<>c.revision::text or r.snapshot->'steps'<>c.steps then raise exception 'Test this saved draft successfully before publishing';end if;
 days:=((r.input::jsonb->>'end_date')::date-(r.input::jsonb->>'start_date')::date)+1;
 perform public.community_clean_activities((r.outputs->-1->>'text')::jsonb->'activities',days);
 if exists(select 1 from jsonb_array_elements(c.steps) s where s->>'prompt' ~ '\{\{(?!input\}\}|previous\}\})') then raise exception 'Unsupported prompt variable';end if;
 select id into v from public.studio_chain_versions where chain_id=c.id and revision=c.revision;
 if v is null then
  select coalesce(max(version_number),0)+1 into n from public.studio_chain_versions where chain_id=c.id;
  insert into public.studio_chain_versions(chain_id,version_number,revision,snapshot,test_run_id,published_by)
  values(c.id,n,c.revision,to_jsonb(c),r.id,auth.uid()) returning id into v;
 end if;
 insert into public.studio_chain_heads(chain_id,publication_id) values(c.id,v) on conflict(chain_id) do update set publication_id=excluded.publication_id,updated_at=clock_timestamp();
 return v;
end;$$;
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
create or replace function public.studio_admin_generations(p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.is_superadmin() is distinct from true then raise exception 'Superadmin required' using errcode='42501';end if;
 return jsonb_build_object('total',(select count(*) from public.studio_trip_runs),'rows',coalesce((select jsonb_agg(to_jsonb(x)) from (
 select r.id,r.trip_id::text,r.version_id,r.proposal_id,r.operation,r.status,r.error,r.created_at,r.finished_at,r.outputs,r.routing_decision,
 t.title trip_title,t.destination,v.version_number itinerary_version,p.id publication_id,p.snapshot->>'id' chain_id,p.snapshot->>'name' chain_name,p.version_number chain_version,
 (case when c.routing_enabled then exists(select 1 from public.studio_chain_heads h where h.publication_id=p.id) else p.id=c.active_version_id end) is_active,
 (select count(*) from public.itinerary_feedback f where f.version_id=r.version_id) rating_count,
 (select jsonb_agg(jsonb_build_object('rating',f.rating,'comment',f.comment,'created_at',f.updated_at) order by f.updated_at desc) from public.itinerary_feedback f where f.version_id=r.version_id) feedback
 from public.studio_trip_runs r join public.studio_chain_versions p on p.id=r.publication_id join public.trips t on t.id=r.trip_id left join public.itinerary_versions v on v.id=r.version_id cross join public.studio_integration_config c
 order by r.created_at desc limit 30 offset greatest(0,least(p_page,10000))*30
 ) x),'[]'::jsonb));
end;$$;
create or replace function public.studio_itinerary_context(p_version uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid bigint;
begin
 select trip_id into tid from public.itinerary_versions where id=p_version;
 if auth.uid() is null or tid is null or not public.collaboration_participant(tid,auth.uid()) then raise exception 'Participant required' using errcode='42501';end if;
 return jsonb_build_object('generation',(select jsonb_build_object('run_id',r.id,'chain_name',p.snapshot->>'name','chain_id',p.snapshot->>'id','publication_id',p.id,'version_number',p.version_number,'status',r.status,'routing_decision',r.routing_decision) from public.studio_trip_runs r join public.studio_chain_versions p on p.id=r.publication_id where r.version_id=p_version order by r.created_at desc limit 1),'feedback',(select jsonb_build_object('rating',rating,'comment',comment) from public.itinerary_feedback where version_id=p_version and user_id=auth.uid()));
end;$$;

-- Idempotent editable regional templates. Never overwrite user content.
do $$
declare source_steps jsonb; item record; steps jsonb;
begin
 select p.snapshot->'steps' into source_steps from public.studio_chain_versions p join public.studio_integration_config c on c.active_version_id=p.id;
 if source_steps is null then select c.steps into source_steps from public.studio_chains c where template_key='trip-planning';end if;
 if jsonb_array_length(source_steps)<>3 then raise exception 'A three-step global itinerary template is required';end if;
 for item in select * from (values
 ('regional-north-america','North America Trip Planner','For destinations in Canada, the United States and Mexico, consider real distances, driving, public transit and accessibility in context. Do not assume a car is necessary. Preserve traveler constraints and avoid claims of verified schedules or availability.'),
 ('regional-europe','Europe Trip Planner','For destinations in this European service scope, consider walkable neighborhood clusters, local public transit and intercity rail when relevant. Compare feasibility rather than assuming trains are always preferable. Preserve traveler constraints and never invent live schedules or availability.'),
 ('regional-china','China Trip Planner','For mainland China destinations, consider local rail and public transportation, applicable reservations, language and payment accessibility, and practical service availability. Do not assume Hong Kong, Macau or Taiwan use the same services. Never invent payment acceptance, ticket availability, opening hours or verified access.')
 ) as templates(key,name,policy) loop
  select jsonb_agg(jsonb_set(jsonb_set(s,'{id}',to_jsonb(gen_random_uuid()::text)),'{prompt}',to_jsonb((s->>'prompt')||case when ord=2 then E'\n'||item.policy else '' end)) order by ord) into steps from jsonb_array_elements(source_steps) with ordinality a(s,ord);
  insert into public.studio_chains(name,description,output_contract,template_key,steps) values(item.name,'Regional three-step TripSync itinerary workflow.','itinerary',item.key,steps) on conflict(template_key) do nothing;
 end loop;
end;$$;
revoke all on function public.studio_publish_regional_chain(uuid,integer,uuid),public.studio_routing_config(jsonb,boolean),public.studio_routing_preview(jsonb) from public,anon;
grant execute on function public.studio_publish_regional_chain(uuid,integer,uuid),public.studio_routing_config(jsonb,boolean),public.studio_routing_preview(jsonb) to authenticated;
commit;
