begin;
create table public.studio_chains (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 100),
 description text not null default '' check(length(description)<=1000),
 steps jsonb not null default '[]' check(jsonb_typeof(steps)='array' and jsonb_array_length(steps)<=8),
 revision integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.studio_runs (
 id uuid primary key default gen_random_uuid(), chain_id uuid references public.studio_chains(id) on delete set null,
 user_id uuid not null references auth.users(id), snapshot jsonb not null, input text not null,
 outputs jsonb not null default '[]', status text not null default 'running' check(status in ('running','completed','failed')),
 error text, created_at timestamptz not null default now(), finished_at timestamptz
);
create index studio_runs_chain on public.studio_runs(chain_id,created_at desc);
alter table public.studio_chains enable row level security;
alter table public.studio_runs enable row level security;
revoke all on public.studio_chains,public.studio_runs from anon,authenticated;
-- Read access and every write independently require the existing checked role function.
grant select on public.studio_chains,public.studio_runs to authenticated;
create policy studio_chains_admin on public.studio_chains for select to authenticated using(public.is_superadmin());
create policy studio_runs_admin on public.studio_runs for select to authenticated using(public.is_superadmin());
create function public.studio_save_chain(p_id uuid,p_revision integer,p_name text,p_description text,p_steps jsonb,p_delete boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare s jsonb; result uuid;
begin
 if public.is_superadmin() is distinct from true then raise exception 'Superadmin required' using errcode='42501'; end if;
 if p_id is not null then
  perform 1 from public.studio_chains where id=p_id and revision=p_revision for update;
  if not found then raise exception 'This chain changed or was deleted. Reload before saving.' using errcode='40001'; end if;
 end if;
 if p_delete then
  if p_id is null then raise exception 'Chain required'; end if;
  delete from public.studio_chains where id=p_id; return p_id;
 end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 100 or p_description is null or length(p_description)>1000
 or p_steps is null or jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps)>8 or octet_length(p_steps::text)>100000 then raise exception 'Invalid chain' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(p_steps) loop
  if jsonb_typeof(s)<>'object' or jsonb_typeof(s->'name') is distinct from 'string' or jsonb_typeof(s->'prompt') is distinct from 'string' or jsonb_typeof(s->'id') is distinct from 'string' or coalesce(length(btrim(s->>'name')),0) not between 1 and 100
  or coalesce(length(btrim(s->>'prompt')),0) not between 1 and 10000
  or coalesce(s->>'id','') !~ '^[a-f0-9-]{36}$' then raise exception 'Each step needs an ID, name and prompt (up to 10000 characters)' using errcode='22023'; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(p_steps))<>(select count(distinct value->>'id') from jsonb_array_elements(p_steps)) then raise exception 'Duplicate step IDs' using errcode='22023'; end if;
 if p_id is null then insert into public.studio_chains(name,description,steps) values(btrim(p_name),p_description,p_steps) returning id into result;
 else update public.studio_chains set name=btrim(p_name),description=p_description,steps=p_steps,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning id into result; end if;
 return result;
end; $$;
create function public.studio_begin_run(p_chain uuid,p_revision integer,p_input text) returns public.studio_runs
language plpgsql security definer set search_path='' as $$
declare c public.studio_chains; r public.studio_runs;
begin
 if public.is_superadmin() is distinct from true then raise exception 'Superadmin required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if exists(select 1 from public.studio_runs where user_id=auth.uid() and status='running' and created_at>now()-interval '10 minutes') then raise exception 'A run is already in progress. Wait for it to finish (up to 10 minutes).' using errcode='22023'; end if;
 update public.studio_runs set status='failed',error='Run interrupted or timed out.',finished_at=now() where user_id=auth.uid() and status='running' and created_at<=now()-interval '10 minutes';
 select * into c from public.studio_chains where id=p_chain and revision=p_revision for share;
 if not found then raise exception 'Chain changed. Reload before running.' using errcode='40001'; end if;
 if jsonb_array_length(c.steps)=0 or p_input is null or length(p_input)>20000 then raise exception 'Add a step and keep input under 20000 characters' using errcode='22023'; end if;
 insert into public.studio_runs(chain_id,user_id,snapshot,input) values(c.id,auth.uid(),to_jsonb(c),p_input) returning * into r;
 return r;
end; $$;
create function public.studio_record_run(p_id uuid,p_output text default null,p_model text default null,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare r public.studio_runs; n integer;
begin
 if public.is_superadmin() is distinct from true then raise exception 'Superadmin required' using errcode='42501'; end if;
 select * into r from public.studio_runs where id=p_id and user_id=auth.uid() and status='running' for update;
 if not found then raise exception 'Run is unavailable' using errcode='42501'; end if;
 if p_error is not null then update public.studio_runs set status='failed',error=left(p_error,1000),finished_at=now() where id=p_id; return; end if;
 if p_output is null or length(p_output) not between 1 and 60000 then raise exception 'Invalid model output'; end if;
 n:=jsonb_array_length(r.outputs)+1;
 update public.studio_runs set outputs=outputs||jsonb_build_array(jsonb_build_object('text',p_output,'model',p_model,'step',n)),
 status=case when n=jsonb_array_length(r.snapshot->'steps') then 'completed' else 'running' end,
 finished_at=case when n=jsonb_array_length(r.snapshot->'steps') then now() else null end where id=p_id;
end; $$;
revoke all on function public.studio_save_chain(uuid,integer,text,text,jsonb,boolean),public.studio_begin_run(uuid,integer,text),public.studio_record_run(uuid,text,text,text) from public,anon;
grant execute on function public.studio_save_chain(uuid,integer,text,text,jsonb,boolean),public.studio_begin_run(uuid,integer,text),public.studio_record_run(uuid,text,text,text) to authenticated;
commit;
