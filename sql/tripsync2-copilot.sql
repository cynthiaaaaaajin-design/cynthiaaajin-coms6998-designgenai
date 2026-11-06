-- Additive Phase A. Requires existing collaboration and Phase 3 migrations.
begin;
create table public.trip_chat_messages (
 id uuid primary key default gen_random_uuid(), trip_id bigint not null references public.trips(id) on delete cascade,
 author_id uuid not null references public.profiles(id), request_id uuid not null,
 content text not null check(length(content) between 1 and 4000),
 version_id uuid references public.itinerary_versions(id),
 response jsonb, created_at timestamptz not null default now(),
 unique(trip_id,author_id,request_id)
);
create index trip_chat_messages_history on public.trip_chat_messages(trip_id,created_at desc,id);
alter table public.trip_chat_messages enable row level security;
grant select on public.trip_chat_messages to authenticated;
create policy chat_member_read on public.trip_chat_messages for select to authenticated
 using(public.collaboration_participant(trip_id,auth.uid()));
-- Writes go through the existing secret-authenticated gateway pattern, never client-supplied assistant text.
create function public.copilot_message(p_secret text,p_trip_id bigint,p_request_id uuid,p_content text,p_version_id uuid,p_response jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.trip_chat_messages; configured text;
begin
 -- Reuse gateway authentication instead of adding another credential store.
 perform public.studio_gateway(p_secret,'routing_context',jsonb_build_object('trip_id',p_trip_id));
 if not public.collaboration_participant(p_trip_id,auth.uid()) then raise exception 'Trip access denied' using errcode='42501';end if;
 if p_version_id is not null and not exists(select 1 from public.itinerary_versions where id=p_version_id and trip_id=p_trip_id) then raise exception 'Invalid version';end if;
 insert into public.trip_chat_messages(trip_id,author_id,request_id,content,version_id)
 values(p_trip_id,auth.uid(),p_request_id,p_content,p_version_id) on conflict do nothing;
 select * into r from public.trip_chat_messages where trip_id=p_trip_id and author_id=auth.uid() and request_id=p_request_id for update;
 if r.content is distinct from p_content or r.version_id is distinct from p_version_id then raise exception 'Request ID already used' using errcode='40001';end if;
 if p_response is not null and r.response is null then
  if pg_column_size(p_response)>50000 then raise exception 'Response too large';end if;
  update public.trip_chat_messages set response=p_response where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end;$$;
revoke all on function public.copilot_message(text,bigint,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.copilot_message(text,bigint,uuid,text,uuid,jsonb) to authenticated;
commit;
