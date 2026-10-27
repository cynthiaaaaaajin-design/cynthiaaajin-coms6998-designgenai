begin;
-- Dedicated records store: resource is a fixed allowlist; all access is through checked RPCs.
create table public.admin_resources (
 id uuid primary key default gen_random_uuid(),
 resource text not null check(resource in ('prompt-chains','prompt-chain-steps','prompt-chain-mix','terms','generation-requests','ai-generation-examples','llm-models','llm-providers','llm-responses','allowed-signup-domains','whitelisted-emails','generated-media','images')),
 data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=200000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.admin_resources enable row level security;
revoke all on public.admin_resources from anon,authenticated;
create index admin_resources_listing on public.admin_resources(resource,created_at desc,id);
create unique index admin_resources_domain on public.admin_resources(lower(data->>'domain')) where resource='allowed-signup-domains';
create unique index admin_resources_email on public.admin_resources(lower(data->>'email')) where resource='whitelisted-emails';
create unique index admin_resources_image_path on public.admin_resources((data->>'path')) where resource='images';
create unique index admin_resources_chain on public.admin_resources((data->>'chain_id')) where resource='prompt-chain-mix';
create function public.admin_observability_list(p_resource text,p_search text default '',p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_superadmin() then raise exception 'Superadmin required' using errcode='42501'; end if;
 return jsonb_build_object('total',(select count(*) from public.admin_resources where resource=p_resource and (id::text||data::text) ilike '%'||left(p_search,200)||'%'),
 'rows',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,data,created_at,updated_at from public.admin_resources where resource=p_resource and (id::text||data::text) ilike '%'||left(p_search,200)||'%' order by created_at desc,id limit 30 offset greatest(0,least(p_page,10000))*30)r),'[]'::jsonb));
end; $$;
create function public.admin_observability_write(p_resource text,p_id uuid,p_data jsonb,p_delete boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; ref text; required text;
begin
 if not public.is_superadmin() then raise exception 'Superadmin required' using errcode='42501'; end if;
 if p_resource not in ('prompt-chain-mix','terms','ai-generation-examples','llm-models','llm-providers','allowed-signup-domains','whitelisted-emails','images') then raise exception 'Read-only resource' using errcode='42501'; end if;
 if p_resource='prompt-chain-mix' and (p_id is null or p_delete) then raise exception 'Mix entries may only be updated' using errcode='42501'; end if;
 if p_delete then
  if exists(select 1 from public.admin_resources where (p_resource='llm-providers' and resource='llm-models' and data->>'provider_id'=p_id::text) or (p_resource='llm-models' and resource='prompt-chain-steps' and data->>'model_id'=p_id::text)) then raise exception 'Record is in use' using errcode='23503'; end if;
  delete from public.admin_resources where id=p_id and resource=p_resource returning id into result;
 else
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>200000 then raise exception 'Enter a JSON object up to 200 KB.' using errcode='22023'; end if;
  for required in select unnest(case p_resource when 'terms' then array['term','definition'] when 'ai-generation-examples' then array['input','output'] when 'llm-models' then array['name','provider_id','model_id'] when 'llm-providers' then array['name'] when 'allowed-signup-domains' then array['domain'] when 'whitelisted-emails' then array['email'] when 'images' then array['title','path'] when 'prompt-chain-mix' then array['chain_id','weight','enabled'] end) loop
   if not (p_data ? required) or p_data->>required is null or btrim(p_data->>required)='' then raise exception 'Missing field: %',required using errcode='22023'; end if;
  end loop;
  if p_resource='allowed-signup-domains' then
   p_data:=jsonb_set(p_data,'{domain}',to_jsonb(lower(btrim(p_data->>'domain'))));
   if p_data->>'domain' !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' then raise exception 'Enter a domain such as example.edu.' using errcode='22023'; end if;
  elsif p_resource='whitelisted-emails' then
   p_data:=jsonb_set(p_data,'{email}',to_jsonb(lower(btrim(p_data->>'email'))));
   if p_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address.' using errcode='22023'; end if;
  elsif p_resource='llm-models' then
   if not exists(select 1 from public.admin_resources where resource='llm-providers' and id::text=p_data->>'provider_id') then raise exception 'Provider does not exist' using errcode='23503'; end if;
   if p_data ? 'enabled' and jsonb_typeof(p_data->'enabled')<>'boolean' then raise exception 'Enabled must be boolean' using errcode='22023'; end if;
  elsif p_resource='prompt-chain-mix' then
   if jsonb_typeof(p_data->'weight')<>'number' or jsonb_typeof(p_data->'enabled')<>'boolean' then raise exception 'Weight must be numeric and enabled must be boolean' using errcode='22023'; end if;
   if (p_data->>'weight')::numeric<=0 or (p_data->>'weight')::numeric>100000 then raise exception 'Weight must be greater than 0 and at most 100000' using errcode='22023'; end if;
   if not exists(select 1 from public.admin_resources where resource='prompt-chains' and id::text=p_data->>'chain_id') then raise exception 'Chain does not exist' using errcode='23503'; end if;
  elsif p_resource='images' then
   if p_id is not null and exists(select 1 from public.admin_resources where id=p_id and resource='images' and data->>'path' is distinct from p_data->>'path') then raise exception 'Image path is immutable. Upload a new image instead.' using errcode='22023'; end if;
   if not exists(select 1 from storage.objects where bucket_id='admin-images' and name=p_data->>'path') then raise exception 'Upload the image before saving its path' using errcode='22023'; end if;
  end if;
  if p_id is null then insert into public.admin_resources(resource,data) values(p_resource,p_data) returning id into result;
  else update public.admin_resources set data=p_data,updated_at=now() where id=p_id and resource=p_resource returning id into result; end if;
 end if;
 if result is null then raise exception 'Record no longer exists' using errcode='22023'; end if;
 return result;
end; $$;
-- Seed the application's two real generation paths. Templates augment the existing
-- safety instructions, scope constraints and structured-output schema.
do $$ declare provider uuid; model uuid; chain uuid; kind text;
begin
 insert into public.admin_resources(resource,data) values('llm-providers','{"name":"Google Gemini","website":"https://ai.google.dev"}') returning id into provider;
 insert into public.admin_resources(resource,data) values('llm-models',jsonb_build_object('name','Gemini (deployment default)','provider_id',provider,'model_id','deployment-default','enabled',true)) returning id into model;
 foreach kind in array array['itinerary','proposal'] loop
  insert into public.admin_resources(resource,data) values('prompt-chains',jsonb_build_object('name',kind,'kind',kind,'description','TripSync structured generation','enabled',true)) returning id into chain;
  insert into public.admin_resources(resource,data) values('prompt-chain-steps',jsonb_build_object('chain_id',chain,'position',0,'model_id',model,'prompt_template','Respect traveler constraints. Return only the requested structured JSON.'));
  insert into public.admin_resources(resource,data) values('prompt-chain-mix',jsonb_build_object('chain_id',chain,'weight',1,'enabled',true));
 end loop;
end $$;
create function public.begin_observed_generation(p_kind text,p_prompt text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare chosen public.admin_resources; step public.admin_resources; model public.admin_resources; request_id uuid; assembled text; weight numeric;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_kind not in ('itinerary','proposal') or length(p_prompt)>150000 then raise exception 'Invalid generation input' using errcode='22023'; end if;
 select c.* into chosen from public.admin_resources c join public.admin_resources mix on mix.resource='prompt-chain-mix' and mix.data->>'chain_id'=c.id::text
 where c.resource='prompt-chains' and c.data->>'kind'=p_kind and c.data->>'enabled'='true' and mix.data->>'enabled'='true' and (mix.data->>'weight')::numeric>0
 order by -ln(greatest(random(),0.000000001))/(mix.data->>'weight')::numeric limit 1;
 if chosen.id is null then raise exception 'No enabled prompt chain for this generation type'; end if;
 select * into step from public.admin_resources where resource='prompt-chain-steps' and data->>'chain_id'=chosen.id::text order by (data->>'position')::integer limit 1;
 select * into model from public.admin_resources where resource='llm-models' and id::text=step.data->>'model_id' and data->>'enabled'='true';
 if model.id is null then raise exception 'No enabled model for prompt chain'; end if;
 assembled:=coalesce(step.data->>'prompt_template','')||E'\n\n'||p_prompt;
 insert into public.admin_resources(resource,data) values('generation-requests',jsonb_build_object('user_id',auth.uid(),'kind',p_kind,'chain_id',chosen.id,'step_id',step.id,'model_id',model.id,'model',model.data->>'model_id','prompt',assembled,'status','pending')) returning id into request_id;
 return jsonb_build_object('id',request_id,'prompt',assembled,'model',model.data->>'model_id');
end $$;
create function public.finish_observed_generation(p_id uuid,p_response text,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare request public.admin_resources;
begin
 select * into request from public.admin_resources where id=p_id and resource='generation-requests' for update;
 if request.id is null or request.data->>'user_id' is distinct from auth.uid()::text or request.data->>'status'<>'pending' then raise exception 'Generation not available' using errcode='42501'; end if;
 if length(p_response)>180000 or length(p_error)>2000 then raise exception 'Response exceeds log limit' using errcode='22023'; end if;
 insert into public.admin_resources(resource,data) values('llm-responses',jsonb_build_object('request_id',p_id,'user_id',auth.uid(),'model_id',request.data->>'model_id','response',p_response,'error',p_error));
 if p_error is null then insert into public.admin_resources(resource,data) values('generated-media',jsonb_build_object('request_id',p_id,'kind',request.data->>'kind','content',p_response)); end if;
 update public.admin_resources set data=data||jsonb_build_object('status',case when p_error is null then 'succeeded' else 'failed' end,'completed_at',now(),'error',p_error),updated_at=now() where id=p_id;
end $$;
-- Private bucket with signed previews. The server action removes the object after metadata deletion.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('admin-images','admin-images',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy admin_images_select on storage.objects for select to authenticated using(bucket_id='admin-images' and public.is_superadmin());
create policy admin_images_insert on storage.objects for insert to authenticated with check(bucket_id='admin-images' and public.is_superadmin());
create policy admin_images_delete on storage.objects for delete to authenticated using(bucket_id='admin-images' and public.is_superadmin());
revoke all on function public.admin_observability_list(text,text,integer),public.admin_observability_write(text,uuid,jsonb,boolean),public.begin_observed_generation(text,text),public.finish_observed_generation(uuid,text,text) from public,anon;
grant execute on function public.admin_observability_list(text,text,integer),public.admin_observability_write(text,uuid,jsonb,boolean),public.begin_observed_generation(text,text),public.finish_observed_generation(uuid,text,text) to authenticated;
commit;
