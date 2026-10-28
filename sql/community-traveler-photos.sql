begin;
create table public.community_photos (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.community_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 path text not null unique,
 caption text not null default '' check(char_length(caption)<=300),
 status text not null default 'pending' check(status in ('pending','approved','rejected','hidden','removed')),
 moderation_note text not null default '' check(char_length(moderation_note)<=300),
 reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.community_photos enable row level security;
revoke all on public.community_photos from anon,authenticated;
grant select(id,post_id,path,status) on public.community_photos to anon,authenticated;
create index community_photos_post on public.community_photos(post_id,created_at desc);
create policy traveler_photo_read on public.community_photos for select using(public.is_superadmin() or user_id=auth.uid() or (status='approved' and exists(select 1 from public.community_posts p where p.id=post_id and p.status='published')));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('traveler-photos','traveler-photos',false,4194304,array['image/jpeg','image/png','image/webp']);
create policy traveler_upload on storage.objects for insert to authenticated with check(bucket_id='traveler-photos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy traveler_file_read on storage.objects for select using(bucket_id='traveler-photos' and (public.is_superadmin() or (storage.foldername(name))[1]=auth.uid()::text or exists(select 1 from public.community_photos f join public.community_posts p on p.id=f.post_id where f.path=name and f.status='approved' and p.status='published')));
-- Only unregistered uploads can be cleaned up. Registered photos use reversible removal.
create policy traveler_upload_cleanup on storage.objects for delete to authenticated using(bucket_id='traveler-photos' and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.community_photos f where f.path=name));

create function public.submit_community_photo(p_post_id uuid,p_path text,p_caption text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 perform 1 from public.community_posts where id=p_post_id and status='published' for share;
 if not found then raise exception 'This Community trip is unavailable' using errcode='22023'; end if;
 -- Serialize submissions to enforce a per-person limit even with simultaneous requests.
 perform 1 from public.profiles where id=auth.uid() for update;
 if (select count(*) from public.community_photos where user_id=auth.uid() and post_id=p_post_id)>=20 then raise exception 'Limit of 20 uploads per person per trip reached' using errcode='22023'; end if;
 if p_path is null or p_path !~ ('^'||auth.uid()::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') or not exists(select 1 from storage.objects where bucket_id='traveler-photos' and name=p_path) then raise exception 'Upload a valid image first' using errcode='22023'; end if;
 if p_caption is null or char_length(p_caption)>300 then raise exception 'Caption must be at most 300 characters' using errcode='22023'; end if;
 insert into public.community_photos(post_id,user_id,path,caption) values(p_post_id,auth.uid(),p_path,btrim(p_caption)) returning id into result;
 return result;
end; $$;
create function public.edit_community_photo(p_id uuid,p_action text,p_caption text default '') returns void
language plpgsql security definer set search_path='' as $$
declare photo public.community_photos;
begin
 select * into photo from public.community_photos where id=p_id for update;
 if auth.uid() is null or photo.user_id is distinct from auth.uid() then raise exception 'Only the uploader can change this photo' using errcode='42501'; end if;
 if p_action='remove' then
  update public.community_photos set status='removed',updated_at=now() where id=p_id;
 elsif p_action='caption' then
  if photo.status not in ('pending','approved') then raise exception 'This photo cannot be edited; contact an administrator' using errcode='22023'; end if;
  if p_caption is null or char_length(p_caption)>300 then raise exception 'Caption must be at most 300 characters' using errcode='22023'; end if;
  -- Editing approved content always requires a new review.
  update public.community_photos set caption=btrim(p_caption),status='pending',moderation_note='',reviewed_by=null,reviewed_at=null,updated_at=now() where id=p_id;
 else raise exception 'Invalid action' using errcode='22023'; end if;
end; $$;
create function public.moderate_community_photo(p_id uuid,p_status text,p_note text,p_expected_updated_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_superadmin() then raise exception 'Superadmin required' using errcode='42501'; end if;
 if p_status is null or p_status not in ('approved','rejected','hidden','removed','pending') or p_note is null or char_length(p_note)>300 then raise exception 'Invalid moderation decision' using errcode='22023'; end if;
 perform 1 from public.community_photos where id=p_id and updated_at=p_expected_updated_at for update;
 if not found then raise exception 'Photo changed. Refresh before reviewing.' using errcode='40001'; end if;
 update public.community_photos set status=p_status,moderation_note=btrim(p_note),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_id;
 if not found then raise exception 'Photo not found' using errcode='22023'; end if;
end; $$;
create function public.list_community_photos(p_post_id uuid default null,p_admin boolean default false,p_status text default '',p_search text default '',p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_admin and not public.is_superadmin() then raise exception 'Superadmin required' using errcode='42501'; end if;
 return (with visible as (
  select f.id,f.post_id,f.path,f.caption,f.status,f.created_at,f.updated_at,
   coalesce(nullif(btrim(u.first_name),''),'Traveler') as author_name,
   f.user_id=auth.uid() as mine,p.title as trip_title,
   case when p_admin or f.user_id=auth.uid() then f.moderation_note else '' end as moderation_note
  from public.community_photos f join public.community_posts p on p.id=f.post_id join public.profiles u on u.id=f.user_id
  where (p_admin or (p.id=p_post_id and p.status='published' and (f.status='approved' or f.user_id=auth.uid())))
   and (not p_admin or coalesce(p_status,'')='' or f.status=p_status)
   and (not p_admin or concat_ws(' ',p.title,f.caption,u.first_name,f.id) ilike '%'||left(coalesce(p_search,''),200)||'%')
 ) select jsonb_build_object('total',(select count(*) from visible),'rows',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from visible order by created_at desc,id limit 30 offset greatest(0,least(coalesce(p_page,0),10000))*30)r),'[]'::jsonb)));
end; $$;
revoke all on function public.submit_community_photo(uuid,text,text),public.edit_community_photo(uuid,text,text),public.moderate_community_photo(uuid,text,text,timestamptz),public.list_community_photos(uuid,boolean,text,text,integer) from public;
grant execute on function public.submit_community_photo(uuid,text,text),public.edit_community_photo(uuid,text,text),public.moderate_community_photo(uuid,text,text,timestamptz) to authenticated;
grant execute on function public.list_community_photos(uuid,boolean,text,text,integer) to anon,authenticated;
commit;
