-- Week 6. Run once in Supabase SQL Editor as postgres after existing TripSync migrations.
begin;
alter table public.profiles add column if not exists is_superadmin boolean not null default false;
-- Even an existing broad profile UPDATE policy must not allow self-promotion.
create or replace function public.guard_superadmin() returns trigger
language plpgsql set search_path='' as $$
begin
 if (auth.uid() is not null or current_user in ('anon','authenticated')) and
 ((TG_OP='INSERT' and new.is_superadmin) or (TG_OP='UPDATE' and (new.is_superadmin is distinct from old.is_superadmin or new.id is distinct from old.id))) then
  raise exception 'Administrator roles are managed through the database console' using errcode='42501';
 end if;
 return new;
end; $$;
create trigger guard_superadmin before insert or update on public.profiles for each row execute function public.guard_superadmin();
create function public.is_superadmin() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((auth.jwt()->'app_metadata'->>'provider')='google' and exists(select 1 from public.profiles where id=auth.uid() and is_superadmin),false);
$$;
revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to anon,authenticated;

create table public.community_posts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
 source_trip_id bigint unique references public.trips(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 200),
 destination text not null check(length(trim(destination)) between 1 and 300),
 description text not null default '' check(length(description)<=2000),
 author_name text not null, days integer not null check(days between 1 and 30),
 activities jsonb not null, status text not null default 'published' check(status in ('published','draft','hidden')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index community_posts_feed on public.community_posts(status,created_at desc);
create table public.community_votes (
 post_id uuid not null references public.community_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 value integer not null check(value in (-1,1)), created_at timestamptz not null default now(),
 primary key(post_id,user_id)
);
alter table public.community_posts enable row level security;
alter table public.community_votes enable row level security;
revoke all on public.community_posts,public.community_votes from public,anon,authenticated;
grant select on public.community_posts to anon,authenticated;
grant select on public.community_votes to authenticated;
create policy community_read on public.community_posts for select using(status='published' or owner_id=auth.uid() or public.is_superadmin());
create policy community_votes_read on public.community_votes for select to authenticated using(user_id=auth.uid() or public.is_superadmin());

-- Whitelist public activity fields. No prompts, preferences, comments, IDs or dates are copied.
create function public.community_clean_activities(p_items jsonb,p_days integer) returns jsonb
language plpgsql set search_path='' as $$
declare a jsonb; result jsonb:='[]'; seen text[]:='{}'; slot text;
begin
 if p_days is null or p_days not between 1 and 30 or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Invalid itinerary'; end if;
 if jsonb_array_length(p_items) not between 1 and 120 then raise exception 'Use 1 to 120 activities'; end if;
 for a in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(a) is distinct from 'object' or coalesce(a->>'day_number','') !~ '^[0-9]{1,2}$' or
   (a->>'day_number')::integer not between 1 and p_days or coalesce(a->>'position','') !~ '^[0-9]{1,3}$' or
   (a->>'position')::integer not between 0 and 119 or jsonb_typeof(a->'title') is distinct from 'string' or
   length(trim(a->>'title')) not between 1 and 200 or
   (a->>'start_time' is not null and (a->>'start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') or
   (a->>'description' is not null and (jsonb_typeof(a->'description')<>'string' or length(a->>'description')>2000)) or
   (a->>'location' is not null and (jsonb_typeof(a->'location')<>'string' or length(a->>'location')>2000)) then raise exception 'Invalid activity'; end if;
  slot:=(a->>'day_number')||':'||(a->>'position');
  if slot=any(seen) then raise exception 'Duplicate activity position'; end if;
  seen:=array_append(seen,slot);
  result:=result||jsonb_build_array(jsonb_build_object('day_number',(a->>'day_number')::integer,'position',(a->>'position')::integer,
   'title',trim(a->>'title'),'start_time',a->>'start_time','description',a->>'description','location',a->>'location'));
 end loop;
 if (select count(distinct x->>'day_number') from jsonb_array_elements(result) x)<>p_days then raise exception 'Every day needs an activity'; end if;
 return (select jsonb_agg(x order by (x->>'day_number')::integer,(x->>'position')::integer) from jsonb_array_elements(result) x);
end; $$;
revoke all on function public.community_clean_activities(jsonb,integer) from public,anon,authenticated;

create function public.publish_community_trip(p_trip_id bigint,p_description text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.trips%rowtype; v uuid; items jsonb; result uuid; day_count integer; display_name text;
begin
 select * into t from public.trips where id=p_trip_id for update;
 if auth.uid() is null or t.user_id is distinct from auth.uid() then raise exception 'Owner required' using errcode='42501'; end if;
 perform 1 from public.community_posts where source_trip_id=p_trip_id for update;
 if exists(select 1 from public.community_posts where source_trip_id=p_trip_id and status='hidden') then raise exception 'This publication is hidden by an administrator. Contact the administrator before publishing again.'; end if;
 select id into v from public.itinerary_versions where trip_id=p_trip_id and exists(select 1 from public.itinerary_items where version_id=itinerary_versions.id) order by version_number desc limit 1;
 day_count:=(t.end_date-t.start_date)+1;
 select jsonb_agg(jsonb_build_object('day_number',day_number,'position',position,'start_time',left(start_time::text,5),'title',title,'description',description,'location',location) order by day_number,position) into items from public.itinerary_items where version_id=v;
 items:=public.community_clean_activities(items,day_count);
 select coalesce(nullif(trim(first_name),''),'Traveler') into display_name from public.profiles where id=auth.uid();
 insert into public.community_posts(owner_id,source_trip_id,title,destination,description,author_name,days,activities)
 values(auth.uid(),p_trip_id,t.title,t.destination,p_description,coalesce(display_name,'Traveler'),day_count,items)
 on conflict(source_trip_id) do update set title=excluded.title,destination=excluded.destination,description=excluded.description,
 author_name=excluded.author_name,days=excluded.days,activities=excluded.activities,status='published',updated_at=now() returning id into result;
 return result;
end; $$;
create function public.withdraw_community_trip(p_trip_id bigint) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.trips where id=p_trip_id and user_id=auth.uid() for update;
 if not found then raise exception 'Owner required' using errcode='42501'; end if;
 update public.community_posts set status='draft',updated_at=now() where source_trip_id=p_trip_id and status<>'hidden';
end; $$;
create function public.rate_community_post(p_post_id uuid,p_value integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 perform 1 from public.community_posts where id=p_post_id and status='published' for update;
 if not found then raise exception 'Publication unavailable' using errcode='42501'; end if;
 if p_value=0 then delete from public.community_votes where post_id=p_post_id and user_id=auth.uid();
 elsif p_value in (-1,1) then
 insert into public.community_votes(post_id,user_id,value) values(p_post_id,auth.uid(),p_value)
 on conflict(post_id,user_id) do update set value=excluded.value,created_at=now();
 else raise exception 'Invalid vote'; end if;
end; $$;
create function public.community_scores(p_ids uuid[]) returns table(post_id uuid,upvotes bigint,downvotes bigint,mine integer)
language sql stable security definer set search_path='' as $$
 select p.id,count(v.value) filter(where v.value=1),count(v.value) filter(where v.value=-1),max(v.value) filter(where v.user_id=auth.uid())
 from public.community_posts p left join public.community_votes v on v.post_id=p.id
 where p.id=any(p_ids) and p.status='published' group by p.id limit 60;
$$;
revoke all on function public.publish_community_trip(bigint,text),public.withdraw_community_trip(bigint),public.rate_community_post(uuid,integer),public.community_scores(uuid[]) from public,anon,authenticated;
grant execute on function public.publish_community_trip(bigint,text),public.withdraw_community_trip(bigint),public.rate_community_post(uuid,integer) to authenticated;
grant execute on function public.community_scores(uuid[]) to anon,authenticated;

-- Admin operates using the signed-in user's JWT, never a service-role key.
create function public.admin_save_media(p_id uuid,p_title text,p_destination text,p_description text,p_days integer,p_activities jsonb,p_status text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; clean jsonb;
begin
 if not public.is_superadmin() then raise exception 'Superadmin required' using errcode='42501'; end if;
 clean:=public.community_clean_activities(p_activities,p_days);
 if p_id is null then
 insert into public.community_posts(owner_id,title,destination,description,author_name,days,activities,status)
 values(auth.uid(),p_title,p_destination,p_description,'TripSync Editorial',p_days,clean,p_status) returning id into result;
 else
 update public.community_posts set title=p_title,destination=p_destination,description=p_description,days=p_days,activities=clean,status=p_status,updated_at=now() where id=p_id returning id into result;
 if result is null then raise exception 'Content no longer exists'; end if;
 end if;
 return result;
end; $$;
create function public.admin_delete_media(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_superadmin() then raise exception 'Superadmin required' using errcode='42501'; end if;
 delete from public.community_posts where id=p_id;
 if not found then raise exception 'Content no longer exists'; end if;
end; $$;

create function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
begin
 if not public.is_superadmin() then raise exception 'Superadmin required' using errcode='42501'; end if;
 return jsonb_build_object(
 'users',(select count(*) from public.profiles), 'trips',(select count(*) from public.trips),
 'ai_versions',(select count(*) from public.itinerary_versions where source in ('ai_initial','ai_revision')),
 'publications',(select count(*) from public.community_posts where status='published'),
 'hidden',(select count(*) from public.community_posts where status='hidden'),
 'shared_trips',(select count(*) from public.community_posts where source_trip_id is not null and status='published'),
 'community_votes',(select count(*) from public.community_votes), 'activity_votes',(select count(*) from public.activity_votes),
 'destinations',coalesce((select jsonb_agg(to_jsonb(x)) from (select destination,count(*) total from public.community_posts where status='published' group by destination order by count(*) desc,destination limit 6) x),'[]'),
 'trend',(select jsonb_agg(jsonb_build_object('day',d::date,'total',(select count(*) from public.community_posts where created_at>=d and created_at<d+interval '1 day')) order by d) from generate_series(current_date-13,current_date,interval '1 day') d),
 'top_posts',coalesce((select jsonb_agg(to_jsonb(x)) from (select p.id,p.title,p.destination,count(v.value) filter(where v.value=1) upvotes,count(v.value) filter(where v.value=-1) downvotes from public.community_posts p left join public.community_votes v on v.post_id=p.id where p.status='published' group by p.id order by count(v.value) filter(where v.value=1)-count(v.value) filter(where v.value=-1) desc,p.created_at desc limit 5) x),'[]'));
end; $$;

create function public.admin_users(p_search text default '',p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_superadmin() then raise exception 'Superadmin required' using errcode='42501'; end if;
 return jsonb_build_object('total',(select count(*) from public.profiles p join auth.users u on u.id=p.id where concat_ws(' ',p.first_name,p.last_name,u.email) ilike '%'||left(p_search,200)||'%'),
 'rows',coalesce((select jsonb_agg(to_jsonb(x)) from (
 select p.id,p.first_name,p.last_name,p.is_superadmin,u.email,u.created_at,
 (select count(*) from public.trips where user_id=p.id) trips,
 (select count(*) from public.community_posts where owner_id=p.id) publications,
 (select count(*) from public.community_votes where user_id=p.id) community_votes
 from public.profiles p join auth.users u on u.id=p.id where concat_ws(' ',p.first_name,p.last_name,u.email) ilike '%'||left(p_search,200)||'%'
 order by u.created_at desc,p.id limit 30 offset greatest(0,least(p_page,100000))*30) x),'[]'));
end; $$;

create function public.admin_ratings(p_page integer default 0,p_kind text default 'community') returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
begin
 if not public.is_superadmin() then raise exception 'Superadmin required' using errcode='42501'; end if;
 if p_kind='activity' then
 return jsonb_build_object('total',(select count(*) from public.activity_votes), 'rows',coalesce((select jsonb_agg(to_jsonb(x)) from (
 select v.user_id,v.value,v.comment,i.title,p.first_name,p.last_name from public.activity_votes v left join public.itinerary_items i on i.id=v.item_id left join public.profiles p on p.id=v.user_id order by v.id desc limit 30 offset greatest(0,least(p_page,100000))*30) x),'[]'));
 end if;
 return jsonb_build_object('total',(select count(*) from public.community_votes),'rows',coalesce((select jsonb_agg(to_jsonb(x)) from (
 select v.user_id,v.value,v.created_at,p.title,u.first_name,u.last_name from public.community_votes v join public.community_posts p on p.id=v.post_id left join public.profiles u on u.id=v.user_id order by v.created_at desc,v.post_id,v.user_id limit 30 offset greatest(0,least(p_page,100000))*30) x),'[]'));
end; $$;
revoke all on function public.admin_save_media(uuid,text,text,text,integer,jsonb,text),public.admin_delete_media(uuid),public.admin_overview(),public.admin_users(text,integer),public.admin_ratings(integer,text) from public,anon,authenticated;
grant execute on function public.admin_save_media(uuid,text,text,text,integer,jsonb,text),public.admin_delete_media(uuid),public.admin_overview(),public.admin_users(text,integer),public.admin_ratings(integer,text) to authenticated;
commit;
