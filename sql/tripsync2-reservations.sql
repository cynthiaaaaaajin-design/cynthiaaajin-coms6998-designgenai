begin;
create table public.trip_reservations(
 id uuid primary key default gen_random_uuid(),trip_id bigint not null references public.trips(id) on delete cascade,
 created_by uuid not null references public.profiles(id),kind text not null check(kind in ('flight','hotel')),
 status text not null check(status in ('planned','saved_option','booked','canceled')),
 details jsonb not null check(jsonb_typeof(details)='object' and pg_column_size(details)<15000),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index trip_reservations_trip on public.trip_reservations(trip_id);
alter table public.trip_reservations enable row level security;
grant select,insert,update,delete on public.trip_reservations to authenticated;
create policy reservations_read on public.trip_reservations for select to authenticated using(public.collaboration_participant(trip_id,auth.uid()));
create policy reservations_insert on public.trip_reservations for insert to authenticated with check(created_by=auth.uid() and public.collaboration_participant(trip_id,auth.uid()));
create policy reservations_update on public.trip_reservations for update to authenticated using(public.collaboration_participant(trip_id,auth.uid()) and (created_by=auth.uid() or exists(select 1 from public.trips where id=trip_id and user_id=auth.uid()))) with check(public.collaboration_participant(trip_id,auth.uid()) and (created_by=auth.uid() or exists(select 1 from public.trips where id=trip_id and user_id=auth.uid())));
create policy reservations_delete on public.trip_reservations for delete to authenticated using(public.collaboration_participant(trip_id,auth.uid()) and (created_by=auth.uid() or exists(select 1 from public.trips where id=trip_id and user_id=auth.uid())));
-- Lock reservation mutations with the existing publication lock to serialize constraints.
create trigger publication_input_lock before insert or update or delete on public.trip_reservations for each row execute function public.publication_input_lock();
commit;
