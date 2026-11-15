-- Whole-trip cascades remove both decision options and their itinerary proposals.
-- Checking this reference before the cascade completes rejects valid trip deletes.
-- Keep NO ACTION and the reference intact; check at transaction completion instead.
-- This changes no rows, permissions or deletion scope. Safe to reapply.
begin;
alter table public.trip_decision_options
  alter constraint trip_decision_options_proposal_id_fkey
  deferrable initially deferred;
commit;
