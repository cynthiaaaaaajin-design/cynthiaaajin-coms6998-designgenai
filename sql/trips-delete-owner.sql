-- Applied after inspecting live policies, FKs and triggers on 2026-10-12.
-- Enables whole-trip deletion only; existing child-table RLS is unchanged.
begin;
create policy trips_delete_owner on public.trips
  for delete to authenticated using (user_id = (select auth.uid()));
alter table public.trip_members drop constraint trip_members_trip_id_fkey,
  add constraint trip_members_trip_id_fkey foreign key (trip_id) references public.trips(id) on delete cascade;
alter table public.itinerary_versions drop constraint itinerary_versions_trip_id_fkey,
  add constraint itinerary_versions_trip_id_fkey foreign key (trip_id) references public.trips(id) on delete cascade;
alter table public.itinerary_items drop constraint itinerary_items_version_id_fkey,
  add constraint itinerary_items_version_id_fkey foreign key (version_id) references public.itinerary_versions(id) on delete cascade;
alter table public.activity_votes drop constraint activity_votes_item_id_fkey,
  add constraint activity_votes_item_id_fkey foreign key (item_id) references public.itinerary_items(id) on delete cascade;
-- Permit deleting all versions together, without cascading into another trip.
alter table public.itinerary_versions drop constraint itinerary_versions_parent_version_id_fkey,
  add constraint itinerary_versions_parent_version_id_fkey foreign key (parent_version_id) references public.itinerary_versions(id) on delete no action deferrable initially deferred;
commit;
