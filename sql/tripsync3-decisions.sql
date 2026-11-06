-- Additive group decision layer. Requires TripSync 2 and tripsync3-preferences.sql.
begin;
create table public.trip_decisions (
 id uuid primary key,trip_id bigint not null references public.trips(id) on delete cascade,
 base_version_id uuid not null,created_by uuid not null references public.profiles(id),
 title text not null check(length(trim(title)) between 1 and 160),topic jsonb not null check(pg_column_size(topic)<20000),
 scope text not null check(scope in ('day','trip')),target_day integer,
 rule text not null check(rule in ('unanimous','majority')),deadline timestamptz,
 electorate uuid[] not null check(cardinality(electorate) between 1 and 100),preference_snapshot jsonb not null,trip_context jsonb not null,
 state text not null default 'preparing' check(state in ('preparing','voting','canceled','applied')),
 created_at timestamptz not null default now(),applied_version_id uuid references public.itinerary_versions(id),decision_snapshot jsonb,
 foreign key(base_version_id,trip_id) references public.itinerary_versions(id,trip_id),
 check(scope='trip' and target_day is null or scope='day' and target_day between 1 and 30)
);
create index trip_decisions_history on public.trip_decisions(trip_id,created_at desc);
create table public.trip_decision_options (
 id uuid primary key,decision_id uuid not null references public.trip_decisions(id) on delete cascade,
 label text not null check(length(trim(label)) between 1 and 100),instruction text not null check(length(trim(instruction)) between 1 and 1500),
 proposal_id uuid unique references public.itinerary_proposals(id),generation_error text,
 generation_token uuid,generating_until timestamptz,claimed_by uuid references public.profiles(id),generated_at timestamptz,constraints_confirmed_by uuid references public.profiles(id),constraints_confirmed_at timestamptz,
 unique(id,decision_id)
);
create table public.trip_decision_votes (
 decision_id uuid not null references public.trip_decisions(id) on delete cascade,user_id uuid not null references public.profiles(id),
 option_id uuid not null,updated_at timestamptz not null default now(),primary key(decision_id,user_id),
 foreign key(option_id,decision_id) references public.trip_decision_options(id,decision_id)
);
alter table public.trip_decisions enable row level security;
alter table public.trip_decision_options enable row level security;
alter table public.trip_decision_votes enable row level security;
revoke all on public.trip_decisions,public.trip_decision_options,public.trip_decision_votes from public,anon,authenticated;
grant select on public.trip_decisions,public.trip_decision_votes to authenticated;
grant select(id,decision_id,label,instruction,proposal_id,generation_error,generated_at,constraints_confirmed_by,constraints_confirmed_at) on public.trip_decision_options to authenticated;
create policy decisions_read on public.trip_decisions for select to authenticated using(public.collaboration_participant(trip_id,auth.uid()));
create policy decision_options_read on public.trip_decision_options for select to authenticated using(exists(select 1 from public.trip_decisions d where d.id=decision_id and public.collaboration_participant(d.trip_id,auth.uid())));
create policy decision_votes_read on public.trip_decision_votes for select to authenticated using(exists(select 1 from public.trip_decisions d where d.id=decision_id and public.collaboration_participant(d.trip_id,auth.uid())));
create function public.decision_trip_context(p_trip bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.collaboration_participant(p_trip,auth.uid()) then raise exception 'Participant required' using errcode='42501';end if;
 return (select jsonb_build_object('destination',destination,'start_date',start_date,'end_date',end_date,'reservations',public.trip_reservation_snapshot(p_trip)) from public.trips where id=p_trip);
end;$$;
create function public.decision_state_internal(p_id uuid,p_exclude uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d public.trip_decisions;latest uuid;threshold integer;winner uuid;received integer;stale boolean;options jsonb;votes jsonb;counts jsonb;
begin
 select * into d from public.trip_decisions where id=p_id;
 if not found or not public.collaboration_participant(d.trip_id,auth.uid()) then raise exception 'Decision unavailable' using errcode='42501';end if;
 select v.id into latest from public.itinerary_versions v where v.trip_id=d.trip_id and v.id is distinct from p_exclude and exists(select 1 from public.itinerary_items i where i.version_id=v.id) order by v.version_number desc limit 1;
 stale:=d.state<>'applied' and (latest is distinct from d.base_version_id or d.preference_snapshot is distinct from public.trip_preference_snapshot(d.trip_id) or d.trip_context is distinct from public.decision_trip_context(d.trip_id));
 threshold:=case when d.rule='unanimous' then cardinality(d.electorate) else cardinality(d.electorate)/2+1 end;
 select count(*) into received from public.trip_decision_votes where decision_id=d.id;
 select v.option_id into winner from public.trip_decision_votes v where v.decision_id=d.id group by v.option_id having count(*)>=threshold;
 select coalesce(jsonb_object_agg(o.id::text,(select count(*) from public.trip_decision_votes v where v.decision_id=d.id and v.option_id=o.id)),'{}') into counts from public.trip_decision_options o where o.decision_id=d.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'instruction',o.instruction,'proposal_id',o.proposal_id,'response_text',p.response_text,'generation_error',o.generation_error,'generated_at',o.generated_at,'constraints_confirmed_by',o.constraints_confirmed_by,'constraints_confirmed_at',o.constraints_confirmed_at) order by o.id),'[]') into options from public.trip_decision_options o left join public.itinerary_proposals p on p.id=o.proposal_id where o.decision_id=d.id;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',v.user_id,'option_id',v.option_id,'updated_at',v.updated_at) order by v.user_id),'[]') into votes from public.trip_decision_votes v where v.decision_id=d.id;
 return to_jsonb(d)||jsonb_build_object('options',options,'votes',votes,'counts',counts,'threshold',threshold,'votes_received',received,'winner_id',winner,'decision_met',winner is not null and not stale and d.state in ('voting','applied'),'stale',stale,'expired',d.deadline is not null and d.deadline<=now());
end;$$;
revoke all on function public.decision_state_internal(uuid,uuid) from public,anon,authenticated;
create function public.decision_round_state(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$ select public.decision_state_internal(p_id,null);$$;
create function public.create_trip_decision(p_secret text,p_trip bigint,p_id uuid,p_base uuid,p_title text,p_topic jsonb,p_scope text,p_day integer,p_rule text,p_deadline timestamptz,p_options jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare snap jsonb;latest uuid;a jsonb;electorate uuid[];existing public.trip_decisions;
begin
 perform public.studio_gateway(p_secret,'routing_context',jsonb_build_object('trip_id',p_trip));
 perform 1 from public.trips where id=p_trip for update;
 if not public.collaboration_participant(p_trip,auth.uid()) then raise exception 'Participant required' using errcode='42501';end if;
 select * into existing from public.trip_decisions where id=p_id;
 if found then
  if existing.trip_id<>p_trip or existing.created_by<>auth.uid() or existing.base_version_id<>p_base or existing.title<>p_title then raise exception 'Request ID already used' using errcode='40001';end if;return existing.id;
 end if;
 if p_scope='trip' and not exists(select 1 from public.trips where id=p_trip and user_id=auth.uid()) then raise exception 'Owner required for full-trip alternatives' using errcode='42501';end if;
 select id into latest from public.itinerary_versions v where trip_id=p_trip and exists(select 1 from public.itinerary_items where version_id=v.id) order by version_number desc limit 1;
 if latest is distinct from p_base then raise exception 'Itinerary changed' using errcode='40001';end if;
 if p_scope='day' and (p_day is null or p_day<1 or p_day>(select end_date-start_date+1 from public.trips where id=p_trip)) then raise exception 'Invalid day';end if;
 if p_deadline is not null and p_deadline<=now() then raise exception 'Choose a future deadline';end if;
 if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) not between 2 and 3 then raise exception 'Create two or three alternatives';end if;
 snap:=public.trip_preference_snapshot(p_trip);
 select array_agg(value::uuid order by value) into electorate from jsonb_array_elements_text(snap->'participants');
 insert into public.trip_decisions(id,trip_id,base_version_id,created_by,title,topic,scope,target_day,rule,deadline,electorate,preference_snapshot,trip_context)
 values(p_id,p_trip,p_base,auth.uid(),p_title,p_topic,p_scope,p_day,p_rule,p_deadline,electorate,snap,public.decision_trip_context(p_trip));
 for a in select value from jsonb_array_elements(p_options) loop
  insert into public.trip_decision_options(id,decision_id,label,instruction) values((a->>'id')::uuid,p_id,a->>'label',a->>'instruction');
 end loop;
 return p_id;
end;$$;
create function public.claim_decision_option(p_secret text,p_id uuid,p_option uuid,p_token uuid,p_error text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.trip_decisions;o public.trip_decision_options;s jsonb;
begin
 select * into d from public.trip_decisions where id=p_id;
 perform public.studio_gateway(p_secret,'routing_context',jsonb_build_object('trip_id',d.trip_id));
 perform 1 from public.trips where id=d.trip_id for update;
 select * into d from public.trip_decisions where id=p_id for update;
 if not public.collaboration_participant(d.trip_id,auth.uid()) then raise exception 'Participant required' using errcode='42501';end if;
 select * into o from public.trip_decision_options where id=p_option and decision_id=p_id for update;
 if not found then raise exception 'Alternative unavailable';end if;
 if p_error is not null then
  if o.generation_token=p_token and o.claimed_by=auth.uid() and o.proposal_id is null then update public.trip_decision_options set generation_error=left(p_error,300),generation_token=null,generating_until=null,claimed_by=null where id=o.id;end if;return '{}';
 end if;
 if o.proposal_id is not null then return jsonb_build_object('proposal_id',o.proposal_id);end if;
 s:=public.decision_state_internal(p_id,null);
 if d.state<>'preparing' or (s->>'stale')::boolean or d.deadline is not null and d.deadline<=clock_timestamp() then raise exception 'Decision changed; start a fresh round' using errcode='40001';end if;
 if o.generating_until>now() then raise exception 'Alternative generation is already running' using errcode='40001';end if;
 update public.trip_decision_options set generation_token=p_token,generating_until=now()+interval '10 minutes',claimed_by=auth.uid(),generation_error=null where id=o.id;
 return jsonb_build_object('claimed',true);
end;$$;
-- Association happens inside the same transaction as proposal persistence: no unguarded apply window.
create function public.link_decision_proposal() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.trip_decisions;o public.trip_decision_options;metadata jsonb;
begin
 metadata:=new.trip_context->'group_decision';
 if metadata is null then return new;end if;
 select * into d from public.trip_decisions where id=(metadata->>'round_id')::uuid for update;
 select * into o from public.trip_decision_options where id=(metadata->>'option_id')::uuid and decision_id=d.id for update;
 if not found or d.state<>'preparing' or o.proposal_id is not null or o.generation_token is distinct from (metadata->>'token')::uuid or o.claimed_by is distinct from auth.uid() or o.generating_until is null or o.generating_until<=now() or d.trip_id<>new.trip_id or d.base_version_id<>new.base_version_id or d.scope<>new.scope or d.target_day is distinct from new.target_day or d.preference_snapshot is distinct from new.preference_snapshot or d.trip_context is distinct from (new.trip_context-'source_action'-'group_decision') then raise exception 'Alternative context changed' using errcode='40001';end if;
 new.trip_context:=jsonb_set(new.trip_context,'{group_decision}',metadata-'token');
 return new;
end;$$;
create function public.finish_decision_proposal() returns trigger language plpgsql security definer set search_path='' as $$
declare metadata jsonb;
begin
 metadata:=new.trip_context->'group_decision';if metadata is null then return new;end if;
 update public.trip_decision_options set proposal_id=new.id,generated_at=now(),generation_token=null,generating_until=null,claimed_by=null,generation_error=null where id=(metadata->>'option_id')::uuid and decision_id=(metadata->>'round_id')::uuid;

 return new;
end;$$;
create trigger decision_proposal_link before insert on public.itinerary_proposals for each row execute function public.link_decision_proposal();
create trigger decision_proposal_ready after insert on public.itinerary_proposals for each row execute function public.finish_decision_proposal();
create function public.review_decision_option(p_id uuid,p_option uuid,p_confirm boolean) returns void language plpgsql security definer set search_path='' as $$
declare d public.trip_decisions;s jsonb;
begin
 select * into d from public.trip_decisions where id=p_id;
 perform 1 from public.trips where id=d.trip_id for update;
 select * into d from public.trip_decisions where id=p_id for update;
 if not public.collaboration_participant(d.trip_id,auth.uid()) or not (d.created_by=auth.uid() or exists(select 1 from public.trips where id=d.trip_id and user_id=auth.uid())) or p_confirm is distinct from true then raise exception 'Initiator or owner review required' using errcode='42501';end if;
 s:=public.decision_state_internal(p_id,null);
 if d.state<>'preparing' or (s->>'stale')::boolean or d.deadline is not null and d.deadline<=clock_timestamp() then raise exception 'Decision changed' using errcode='40001';end if;
 update public.trip_decision_options set constraints_confirmed_by=auth.uid(),constraints_confirmed_at=now() where id=p_option and decision_id=p_id and proposal_id is not null;
 if not found then raise exception 'Generate the alternative before review';end if;
 if not exists(select 1 from public.trip_decision_options where decision_id=p_id and (proposal_id is null or constraints_confirmed_at is null)) then update public.trip_decisions set state='voting' where id=p_id;end if;
end;$$;
create function public.vote_trip_decision(p_id uuid,p_option uuid) returns void language plpgsql security definer set search_path='' as $$
declare d public.trip_decisions;s jsonb;
begin
 select * into d from public.trip_decisions where id=p_id;
 perform 1 from public.trips where id=d.trip_id for update;
 select * into d from public.trip_decisions where id=p_id for update;
 if not public.collaboration_participant(d.trip_id,auth.uid()) or not auth.uid()=any(d.electorate) then raise exception 'Eligible member required' using errcode='42501';end if;
 s:=public.decision_state_internal(p_id,null);
 if d.state<>'voting' or (s->>'stale')::boolean or d.deadline is not null and d.deadline<=clock_timestamp() then raise exception 'Voting is closed, stale or expired' using errcode='40001';end if;
 if not exists(select 1 from public.trip_decision_options where id=p_option and decision_id=p_id and proposal_id is not null) then raise exception 'Invalid alternative';end if;
 insert into public.trip_decision_votes(decision_id,user_id,option_id) values(p_id,auth.uid(),p_option) on conflict(decision_id,user_id) do update set option_id=excluded.option_id,updated_at=now();
end;$$;
create function public.guard_decision_publication() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.trip_decisions;o public.trip_decision_options;s jsonb;
begin
 if new.applied_version_id is null or old.applied_version_id is not null then return new;end if;
 select * into o from public.trip_decision_options where proposal_id=new.id;
 if not found then return new;end if;
 select * into d from public.trip_decisions where id=o.decision_id for update;
 s:=public.decision_state_internal(d.id,new.applied_version_id);
 if current_setting('tripsync.confirm_decision',true) is distinct from d.id::text or d.state<>'voting' or not (s->>'decision_met')::boolean or (s->>'winner_id')::uuid is distinct from o.id or not exists(select 1 from public.trips where id=d.trip_id and user_id=auth.uid()) then raise exception 'A qualifying group decision and owner confirmation are required' using errcode='42501';end if;
 if not exists(select 1 from public.itinerary_versions where id=new.applied_version_id and parent_version_id=d.base_version_id and trip_id=d.trip_id) then raise exception 'Invalid publication parent' using errcode='40001';end if;
 update public.trip_decisions set state='applied',applied_version_id=new.applied_version_id,decision_snapshot=jsonb_build_object('winner_id',o.id,'proposal_id',o.proposal_id,'electorate',d.electorate,'rule',d.rule,'threshold',s->'threshold','votes',s->'votes','counts',s->'counts','confirmed_by',auth.uid(),'confirmed_at',now(),'preference_snapshot',d.preference_snapshot,'trip_context',d.trip_context) where id=d.id;
 return new;
end;$$;
create trigger decision_publication_guard before update of applied_version_id on public.itinerary_proposals for each row execute function public.guard_decision_publication();
create function public.apply_trip_decision(p_id uuid,p_option uuid,p_confirm boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.trip_decisions;s jsonb;proposal uuid;result uuid;
begin
 select * into d from public.trip_decisions where id=p_id;
 perform 1 from public.trips where id=d.trip_id and user_id=auth.uid() for update;
 if not found or p_confirm is distinct from true then raise exception 'Owner confirmation required' using errcode='42501';end if;
 select * into d from public.trip_decisions where id=p_id for update;
 s:=public.decision_state_internal(p_id,null);
 if d.state<>'voting' or not (s->>'decision_met')::boolean or (s->>'winner_id')::uuid is distinct from p_option then raise exception 'No current qualifying decision' using errcode='40001';end if;
 select proposal_id into proposal from public.trip_decision_options where id=p_option and decision_id=p_id;
 perform set_config('tripsync.confirm_decision',p_id::text,true);
 result:=public.apply_itinerary_proposal(d.trip_id,proposal);
 perform set_config('tripsync.confirm_decision','',true);
 return result;
end;$$;
create function public.cancel_trip_decision(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare d public.trip_decisions;
begin
 select * into d from public.trip_decisions where id=p_id;
 perform 1 from public.trips where id=d.trip_id for update;
 select * into d from public.trip_decisions where id=p_id for update;
 if not public.collaboration_participant(d.trip_id,auth.uid()) or not (d.created_by=auth.uid() or exists(select 1 from public.trips where id=d.trip_id and user_id=auth.uid())) then raise exception 'Decision permission denied' using errcode='42501';end if;
 if d.state not in ('preparing','voting') then raise exception 'Decision is already closed' using errcode='40001';end if;
 update public.trip_decisions set state='canceled' where id=d.id;
end;$$;
revoke all on function public.link_decision_proposal(),public.finish_decision_proposal(),public.guard_decision_publication() from public,anon,authenticated;
revoke all on function public.decision_trip_context(bigint),public.decision_round_state(uuid),public.create_trip_decision(text,bigint,uuid,uuid,text,jsonb,text,integer,text,timestamptz,jsonb),public.claim_decision_option(text,uuid,uuid,uuid,text),public.review_decision_option(uuid,uuid,boolean),public.vote_trip_decision(uuid,uuid),public.apply_trip_decision(uuid,uuid,boolean),public.cancel_trip_decision(uuid) from public,anon;
grant execute on function public.decision_trip_context(bigint),public.decision_round_state(uuid),public.create_trip_decision(text,bigint,uuid,uuid,text,jsonb,text,integer,text,timestamptz,jsonb),public.claim_decision_option(text,uuid,uuid,uuid,text),public.review_decision_option(uuid,uuid,boolean),public.vote_trip_decision(uuid,uuid),public.apply_trip_decision(uuid,uuid,boolean),public.cancel_trip_decision(uuid) to authenticated;
create function public.list_trip_decisions(p_trip bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.collaboration_participant(p_trip,auth.uid()) then raise exception 'Participant required' using errcode='42501';end if;
 select coalesce(jsonb_agg((s-'preference_snapshot'-'trip_context'-'decision_snapshot')||jsonb_build_object('options',(select jsonb_agg(o-'response_text'||jsonb_build_object('response_text',null)) from jsonb_array_elements(s->'options') o)) order by created_at desc,id desc),'[]') into result from (select d.id,d.created_at,public.decision_state_internal(d.id,null) s from public.trip_decisions d where d.trip_id=p_trip order by d.created_at desc,d.id desc limit 20) summaries;
 return result;
end;$$;
revoke all on function public.list_trip_decisions(bigint) from public,anon;
grant execute on function public.list_trip_decisions(bigint) to authenticated;
commit;
