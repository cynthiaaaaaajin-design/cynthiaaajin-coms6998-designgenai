-- Additive TripSync-only migration. Requires chain-studio.sql, Phase 3 and Week 6.
-- No provider credentials are stored here. Configure a random server integration
-- secret's SHA-256 hash separately after explicit approval; never commit its value.
begin;
alter table public.studio_chains add column output_contract text not null default 'text' check(output_contract in ('text','itinerary'));
alter table public.studio_chains add column template_key text unique;
create table public.studio_chain_versions (
 id uuid primary key default gen_random_uuid(), chain_id uuid references public.studio_chains(id) on delete set null,
 version_number integer not null, revision integer not null, snapshot jsonb not null,
 test_run_id uuid not null references public.studio_runs(id), published_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), unique(chain_id,revision),unique(chain_id,version_number)
);
create table public.studio_integration_config (
 slot text primary key check(slot='trip-planning'),
 active_version_id uuid references public.studio_chain_versions(id), secret_hash text check(secret_hash ~ '^[0-9a-f]{64}$')
);
insert into public.studio_integration_config(slot) values('trip-planning');
create table public.studio_trip_runs (
 id uuid primary key default gen_random_uuid(), publication_id uuid not null references public.studio_chain_versions(id),
 trip_id bigint not null references public.trips(id) on delete cascade,
 version_id uuid references public.itinerary_versions(id) on delete set null,
 base_version_id uuid references public.itinerary_versions(id) on delete set null,
 proposal_id uuid references public.itinerary_proposals(id) on delete set null,
 user_id uuid not null references auth.users(id), operation text not null check(operation in ('initial','repair','revision')),
 input text not null, outputs jsonb not null default '[]',
 status text not null default 'running' check(status in ('running','ready','completed','failed')),
 error text, created_at timestamptz not null default now(), finished_at timestamptz
);
create index studio_trip_runs_trip on public.studio_trip_runs(trip_id,created_at desc);
create index studio_trip_runs_version on public.studio_trip_runs(version_id);
create unique index studio_trip_runs_proposal on public.studio_trip_runs(proposal_id) where proposal_id is not null;
create table public.itinerary_feedback (
 version_id uuid not null references public.itinerary_versions(id) on delete cascade,
 user_id uuid not null references auth.users(id), rating integer not null check(rating between 1 and 5),
 comment text not null default '' check(length(comment)<=1000), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), primary key(version_id,user_id)
);
alter table public.studio_chain_versions enable row level security;
alter table public.studio_integration_config enable row level security;
alter table public.studio_trip_runs enable row level security;
alter table public.itinerary_feedback enable row level security;
revoke all on public.studio_chain_versions,public.studio_integration_config,public.studio_trip_runs,public.itinerary_feedback from anon,authenticated;
grant select on public.studio_chain_versions to authenticated;
create policy studio_versions_admin on public.studio_chain_versions for select to authenticated using(public.is_superadmin());

create function public.studio_publication_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.is_superadmin() is distinct from true then raise exception 'Superadmin required' using errcode='42501';end if;
 return (select jsonb_build_object('active_version_id',active_version_id,'configured',secret_hash is not null) from public.studio_integration_config where slot='trip-planning');
end;$$;

create function public.studio_publish_chain(p_chain uuid,p_revision integer,p_run uuid) returns uuid language plpgsql security definer set search_path='' as $$
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
 update public.studio_integration_config set active_version_id=v where slot='trip-planning';
 return v;
end;$$;

-- This RPC has TWO independent gates: a validated traveler JWT and a random
-- server-only credential. Ordinary travelers cannot retrieve private prompts or
-- forge provider outputs by calling PostgREST directly.
create function public.studio_gateway(p_secret text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.studio_trip_runs;pub public.studio_chain_versions;t public.trips;v public.itinerary_versions;items jsonb;pid uuid;days integer;n integer;
begin
 if auth.uid() is null or p_secret is null or length(p_secret)<32 or not exists(select 1 from public.studio_integration_config where slot='trip-planning' and secret_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex')) then raise exception 'Server authorization required' using errcode='42501';end if;
 if p_data is null or octet_length(p_data::text)>1000000 then raise exception 'Invalid request';end if;
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
  select p.* into pub from public.studio_chain_versions p join public.studio_integration_config c on c.active_version_id=p.id where c.slot='trip-planning';
  if pub.id is null or pub.snapshot->>'output_contract'<>'itinerary' then raise exception 'Publish a tested Trip Planning Assistant in Chain Studio first';end if;
  insert into public.studio_trip_runs(publication_id,trip_id,version_id,base_version_id,user_id,operation,input)
  values(pub.id,t.id,case when p_data->>'operation'='revision' then null else v.id end,v.id,auth.uid(),p_data->>'operation',p_data->>'input') returning * into r;
  return jsonb_build_object('id',r.id,'publication_id',pub.id,'version_number',pub.version_number,'snapshot',pub.snapshot);
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

create function public.studio_link_applied_proposal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.applied_version_id is not null and old.applied_version_id is null then
  update public.studio_trip_runs set version_id=new.applied_version_id where proposal_id=new.id;
 end if;return new;
end;$$;
create trigger studio_link_applied_proposal after update of applied_version_id on public.itinerary_proposals for each row execute function public.studio_link_applied_proposal();

create function public.studio_rate_itinerary(p_version uuid,p_rating integer,p_comment text default '') returns void language plpgsql security definer set search_path='' as $$
declare tid bigint;
begin
 select trip_id into tid from public.itinerary_versions where id=p_version;
 if auth.uid() is null or tid is null or not public.collaboration_participant(tid,auth.uid()) then raise exception 'Participant required' using errcode='42501';end if;
 if not exists(select 1 from public.itinerary_items where version_id=p_version) or p_rating is null or p_rating not between 1 and 5 or p_comment is null or length(p_comment)>1000 then raise exception 'Rate a completed itinerary from 1 to 5';end if;
 insert into public.itinerary_feedback(version_id,user_id,rating,comment) values(p_version,auth.uid(),p_rating,p_comment)
 on conflict(version_id,user_id) do update set rating=excluded.rating,comment=excluded.comment,updated_at=clock_timestamp();
end;$$;
create function public.studio_itinerary_context(p_version uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tid bigint;
begin
 select trip_id into tid from public.itinerary_versions where id=p_version;
 if auth.uid() is null or tid is null or not public.collaboration_participant(tid,auth.uid()) then raise exception 'Participant required' using errcode='42501';end if;
 return jsonb_build_object('generation',(select jsonb_build_object('run_id',r.id,'chain_name',p.snapshot->>'name','chain_id',p.snapshot->>'id','publication_id',p.id,'version_number',p.version_number,'status',r.status) from public.studio_trip_runs r join public.studio_chain_versions p on p.id=r.publication_id where r.version_id=p_version order by r.created_at desc limit 1),'feedback',(select jsonb_build_object('rating',rating,'comment',comment) from public.itinerary_feedback where version_id=p_version and user_id=auth.uid()));
end;$$;
create function public.studio_admin_generations(p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.is_superadmin() is distinct from true then raise exception 'Superadmin required' using errcode='42501';end if;
 return jsonb_build_object('total',(select count(*) from public.studio_trip_runs),'rows',coalesce((select jsonb_agg(to_jsonb(x)) from (
 select r.id,r.trip_id::text,r.version_id,r.proposal_id,r.operation,r.status,r.error,r.created_at,r.finished_at,r.outputs,
 t.title trip_title,t.destination,v.version_number itinerary_version,p.id publication_id,p.snapshot->>'id' chain_id,p.snapshot->>'name' chain_name,p.version_number chain_version,
 (p.id=c.active_version_id) is_active,
 (select count(*) from public.itinerary_feedback f where f.version_id=r.version_id) rating_count,
 (select jsonb_agg(jsonb_build_object('rating',f.rating,'comment',f.comment,'created_at',f.updated_at) order by f.updated_at desc) from public.itinerary_feedback f where f.version_id=r.version_id) feedback
 from public.studio_trip_runs r join public.studio_chain_versions p on p.id=r.publication_id join public.trips t on t.id=r.trip_id left join public.itinerary_versions v on v.id=r.version_id cross join public.studio_integration_config c
 order by r.created_at desc limit 30 offset greatest(0,least(p_page,10000))*30
 ) x),'[]'::jsonb));
end;$$;

revoke all on function public.studio_publication_status(),public.studio_publish_chain(uuid,integer,uuid),public.studio_gateway(text,text,jsonb),public.studio_rate_itinerary(uuid,integer,text),public.studio_itinerary_context(uuid),public.studio_admin_generations(integer) from public,anon;
grant execute on function public.studio_publication_status(),public.studio_publish_chain(uuid,integer,uuid),public.studio_gateway(text,text,jsonb),public.studio_rate_itinerary(uuid,integer,text),public.studio_itinerary_context(uuid),public.studio_admin_generations(integer) to authenticated;
revoke all on function public.studio_link_applied_proposal() from public,anon,authenticated;

-- Idempotent seed: no modification of existing chains or travelers.
insert into public.studio_chains(name,description,output_contract,template_key,steps) values(
 'Trip Planning Assistant','Analyze preferences, draft a plan, and return a validated TripSync itinerary.','itinerary','trip-planning',
 jsonb_build_array(
 jsonb_build_object('id',gen_random_uuid(),'name','Analyze Travel Preferences','prompt','Normalize the travel requirements in {{input}}. Preserve destination, dates, budget, interests, group preferences, hard constraints, requested revision scope and instructions. Do not invent missing preferences: mark them unspecified. Return a concise structured requirements summary.'),
 jsonb_build_object('id',gen_random_uuid(),'name','Generate an Itinerary Draft','prompt','Use these normalized requirements: {{previous}}. Refer to the original request {{input}} for exact dates, constraints and revision scope. Draft a feasible day-by-day plan with 2–4 activities per requested day, suitable pacing and budget guidance where specified. Preserve any requested revision scope. Never claim live booking availability, verified opening hours, exact transit times or prices.'),
 jsonb_build_object('id',gen_random_uuid(),'name','Review Constraints and Produce Final Structured Output','prompt','Review this draft: {{previous}} against the original request {{input}}. Respect every hard constraint, trip date and requested revision scope. Return only the exact JSON required by the original request: activities with day_number, position (zero-based consecutive within each day), start_time (HH:MM or null), title, description and location. Include every requested day for whole-trip generation; for partial revisions return only the requested scope and include explanation and uncertainties as required by the request. Flag unresolved constraints in descriptions or uncertainties, without inventing facts. No markdown or database IDs.')
 )) on conflict(template_key) do nothing;
commit;
