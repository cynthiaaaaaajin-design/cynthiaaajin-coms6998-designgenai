-- Manual review/apply only. Keeps the existing owner/member privacy boundary.
-- Do not execute automatically. No INSERT, UPDATE or DELETE policy changes.
begin;
alter policy trips_select_authorized
on public.trips
to authenticated
using (
  user_id = (select auth.uid())
  or private.can_access_trip(id)
);
commit;
