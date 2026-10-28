begin;
create or replace function public.community_save_context(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare post public.community_posts%rowtype; saved bigint;
begin
 select * into post from public.community_posts where id=p_post_id and status='published';
 if not found then return jsonb_build_object('state','unavailable'); end if;
 if auth.uid() is null then return jsonb_build_object('state','signin'); end if;
 if post.owner_id=auth.uid() then
  return jsonb_build_object('state','author','trip_id',case when post.source_trip_id is not null and public.collaboration_participant(post.source_trip_id,auth.uid()) then post.source_trip_id::text else null end);
 end if;
 if post.source_trip_id is not null and public.collaboration_participant(post.source_trip_id,auth.uid()) then
  return jsonb_build_object('state','member','trip_id',post.source_trip_id::text);
 end if;
 select trip_id into saved from public.community_imports where imported_by=auth.uid() and source_post_id=p_post_id;
 if found then return jsonb_build_object('state','saved','trip_id',saved::text); end if;
 return jsonb_build_object('state','available');
end $$;
revoke all on function public.community_save_context(uuid) from public,anon;
grant execute on function public.community_save_context(uuid) to authenticated;

create or replace function public.import_community_trip(p_post_id uuid,p_start_date date) returns text
language plpgsql security definer set search_path='' as $$
declare post public.community_posts%rowtype; new_trip bigint; version_id uuid:=gen_random_uuid(); clean jsonb; a jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to save a trip' using errcode='42501'; end if;
 if p_start_date is null or p_start_date<date '0001-01-01' or p_start_date>date '9999-12-01' then raise exception 'Choose a valid start date' using errcode='22023'; end if;
 -- Serialize duplicate clicks for this user without changing any profile data.
 perform 1 from public.profiles where id=auth.uid() for update;
 if not found then raise exception 'Complete your profile before saving a trip' using errcode='22023'; end if;
 select * into post from public.community_posts where id=p_post_id and status='published';
 if not found then raise exception 'This publication is no longer available' using errcode='22023'; end if;
 -- Membership changes and publication use the same trip lock. Acquire it before
 -- locking the post, matching the original publication lock order.
 if post.source_trip_id is not null then perform 1 from public.trips where id=post.source_trip_id for update; end if;
 select * into post from public.community_posts where id=p_post_id and status='published' for share;
 if not found then raise exception 'This publication is no longer available' using errcode='22023'; end if;
 if post.owner_id=auth.uid() then raise exception 'You shared this itinerary. Open your existing trip instead.' using errcode='42501'; end if;
 if post.source_trip_id is not null and public.collaboration_participant(post.source_trip_id,auth.uid()) then
  raise exception 'You already belong to this trip. Open it from My trips instead.' using errcode='42501';
 end if;
 select trip_id into new_trip from public.community_imports where imported_by=auth.uid() and source_post_id=p_post_id;
 if found then return new_trip::text; end if;
 clean:=public.community_clean_activities(post.activities,post.days);
 insert into public.trips(user_id,title,destination,start_date,end_date)
 values(auth.uid(),post.title,post.destination,p_start_date,p_start_date+post.days-1) returning id into new_trip;
 insert into public.itinerary_versions(id,trip_id,version_number,created_by,source,prompt_text,response_text)
 values(version_id,new_trip,1,auth.uid(),'manual',null,null);
 insert into public.community_imports(trip_id,imported_by,source_post_id,author_name,imported_version_id)
 values(new_trip,auth.uid(),post.id,post.author_name,version_id);
 -- Only public content is copied: no original IDs, prompts, votes, preferences or members.
 insert into public.itinerary_items(version_id,day_number,position,start_time,title,description,location,origin)
 select version_id,(x->>'day_number')::integer,
 (row_number() over(partition by x->>'day_number' order by (x->>'position')::integer)-1)::integer,
 (x->>'start_time')::time,x->>'title',x->>'description',x->>'location','manual'
 from jsonb_array_elements(clean) x;
 return new_trip::text;
end $$;
commit;
