begin;
create table public.trip_settlements (
 id uuid primary key default gen_random_uuid(),trip_id bigint not null references public.trips(id) on delete cascade,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 balances jsonb not null,transfers jsonb not null
);
create table public.trip_expenses (
 id uuid primary key,trip_id bigint not null references public.trips(id) on delete cascade,
 created_by uuid not null references public.profiles(id),payer_id uuid not null references public.profiles(id),
 description text not null check(length(trim(description)) between 1 and 200),amount bigint not null check(amount between 1 and 100000000000),
 currency text not null check(currency in ('USD','EUR','CNY','GBP','JPY','CAD','AUD','CHF','KRW','INR','SGD','HKD','KWD')),
 allocations jsonb not null,split_method text not null check(split_method in ('equal','custom','percentage')),
 expense_date date not null,category text not null check(category in ('Food & Drinks','Transportation','Accommodation','Activities','Shopping','Other')),
 note text not null default '' check(length(note)<=2000),created_at timestamptz not null default now(),
 settlement_id uuid references public.trip_settlements(id)
);
create index trip_expenses_trip on public.trip_expenses(trip_id,created_at);
create table public.trip_transfer_receipts (
 settlement_id uuid not null references public.trip_settlements(id) on delete cascade,transfer_index integer not null,
 marked_by uuid not null references public.profiles(id),marked_at timestamptz not null default now(),primary key(settlement_id,transfer_index)
);
alter table public.trip_expenses enable row level security;
alter table public.trip_settlements enable row level security;
alter table public.trip_transfer_receipts enable row level security;
grant select on public.trip_expenses,public.trip_settlements,public.trip_transfer_receipts to authenticated;
create policy expenses_read on public.trip_expenses for select to authenticated using(public.collaboration_participant(trip_id,auth.uid()));
create policy settlements_read on public.trip_settlements for select to authenticated using(public.collaboration_participant(trip_id,auth.uid()));
create policy receipts_read on public.trip_transfer_receipts for select to authenticated using(exists(select 1 from public.trip_settlements s where s.id=settlement_id and public.collaboration_participant(s.trip_id,auth.uid())));
create function public.save_trip_expense(p_trip bigint,p_id uuid,p_value jsonb,p_delete boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.trip_expenses; a jsonb; total bigint:=0;seen uuid[]:='{}';who uuid; owner_id uuid;
begin
 select user_id into owner_id from public.trips where id=p_trip for update;
 if not public.collaboration_participant(p_trip,auth.uid()) then raise exception 'Participant required' using errcode='42501';end if;
 select * into old from public.trip_expenses where id=p_id for update;
 if found then
  if old.trip_id<>p_trip or old.created_by<>auth.uid() and owner_id<>auth.uid() then raise exception 'Expense permission denied' using errcode='42501';end if;
  if old.settlement_id is not null then raise exception 'Settled expenses are immutable. Add an adjustment in a new cycle.' using errcode='40001';end if;
 end if;
 if p_delete then delete from public.trip_expenses where id=p_id and trip_id=p_trip;return p_id;end if;
 if not public.collaboration_participant(p_trip,(p_value->>'payer_id')::uuid) or jsonb_typeof(p_value->'allocations') is distinct from 'array' or jsonb_array_length(p_value->'allocations') not between 1 and 100 then raise exception 'Invalid payer or participants';end if;
 for a in select value from jsonb_array_elements(p_value->'allocations') loop
  who:=(a->>'user_id')::uuid;
  if who=any(seen) or not public.collaboration_participant(p_trip,who) or a->>'amount' is null or (a->>'amount') !~ '^\d+$' or (a->>'amount')::bigint>100000000000 then raise exception 'Invalid allocation';end if;
  total:=total+(a->>'amount')::bigint;seen:=array_append(seen,who);
 end loop;
 if total is distinct from (p_value->>'amount')::bigint then raise exception 'Allocations must equal expense';end if;
 insert into public.trip_expenses(id,trip_id,created_by,payer_id,description,amount,currency,allocations,split_method,expense_date,category,note)
 values(p_id,p_trip,coalesce(old.created_by,auth.uid()),(p_value->>'payer_id')::uuid,p_value->>'description',(p_value->>'amount')::bigint,p_value->>'currency',p_value->'allocations',p_value->>'split_method',(p_value->>'expense_date')::date,p_value->>'category',coalesce(p_value->>'note',''))
 on conflict(id) do update set payer_id=excluded.payer_id,description=excluded.description,amount=excluded.amount,currency=excluded.currency,allocations=excluded.allocations,split_method=excluded.split_method,expense_date=excluded.expense_date,category=excluded.category,note=excluded.note;
 return p_id;
end;$$;
-- Fingerprint includes all open records; finalized snapshots are immutable, new expenses start another cycle.
create function public.expense_cycle_fingerprint(p_trip bigint) returns text language sql stable security definer set search_path='' as $$
 select md5(coalesce(jsonb_agg(to_jsonb(e) order by id)::text,'[]')) from public.trip_expenses e where trip_id=p_trip and settlement_id is null and public.collaboration_participant(p_trip,auth.uid());$$;
create function public.finalize_trip_settlement(p_trip bigint,p_fingerprint text) returns uuid language plpgsql security definer set search_path='' as $$
declare snapshot uuid; c record; debtor record; creditor record; n bigint; rows jsonb:='[]';balances jsonb;work jsonb;
begin
 perform 1 from public.trips where id=p_trip and user_id=auth.uid() for update;
 if not found then raise exception 'Owner required' using errcode='42501';end if;
 if public.expense_cycle_fingerprint(p_trip) is distinct from p_fingerprint then raise exception 'Expenses changed; refresh the preview' using errcode='40001';end if;
 if not exists(select 1 from public.trip_expenses where trip_id=p_trip and settlement_id is null) then raise exception 'No open expenses';end if;
 select jsonb_agg(jsonb_build_object('currency',currency,'user_id',user_id,'balance',balance) order by currency,user_id) into balances from (
 select currency,user_id,sum(s.n) balance from (
 select currency,payer_id user_id,amount n from public.trip_expenses where trip_id=p_trip and settlement_id is null
 union all select e.currency,(a->>'user_id')::uuid,-(a->>'amount')::bigint from public.trip_expenses e cross join lateral jsonb_array_elements(e.allocations) a where e.trip_id=p_trip and e.settlement_id is null
 ) s group by currency,user_id) ledger;
 work:=balances;
 if exists(select 1 from jsonb_array_elements(work) w group by w->>'currency' having sum((w->>'balance')::bigint)<>0) then raise exception 'Ledger imbalance';end if;
 for c in select distinct w->>'currency' currency from jsonb_array_elements(work) w order by currency loop
  loop
   select w->>'user_id' user_id,(w->>'balance')::bigint balance,(ord-1)::text idx into debtor from jsonb_array_elements(work) with ordinality q(w,ord) where w->>'currency'=c.currency and (w->>'balance')::bigint<0 order by w->>'user_id' limit 1;
   exit when not found;
   select w->>'user_id' user_id,(w->>'balance')::bigint balance,(ord-1)::text idx into creditor from jsonb_array_elements(work) with ordinality q(w,ord) where w->>'currency'=c.currency and (w->>'balance')::bigint>0 order by w->>'user_id' limit 1;
   if not found then raise exception 'Residual imbalance';end if;
   n:=least(-debtor.balance,creditor.balance);
   rows:=rows||jsonb_build_array(jsonb_build_object('from',debtor.user_id,'to',creditor.user_id,'amount',n,'currency',c.currency));
   work:=jsonb_set(work,array[debtor.idx,'balance'],to_jsonb(debtor.balance+n));
   work:=jsonb_set(work,array[creditor.idx,'balance'],to_jsonb(creditor.balance-n));
  end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(work) w where (w->>'balance')::bigint<>0) then raise exception 'Residual imbalance';end if;
 insert into public.trip_settlements(trip_id,created_by,balances,transfers) values(p_trip,auth.uid(),balances,rows) returning id into snapshot;
 update public.trip_expenses set settlement_id=snapshot where trip_id=p_trip and settlement_id is null;
 return snapshot;
end;$$;
create function public.mark_trip_transfer_paid(p_trip bigint,p_settlement uuid,p_index integer) returns void language plpgsql security definer set search_path='' as $$
declare transfer jsonb;
begin
 if not public.collaboration_participant(p_trip,auth.uid()) then raise exception 'Participant required' using errcode='42501';end if;
 select transfers->p_index into transfer from public.trip_settlements where id=p_settlement and trip_id=p_trip and p_index>=0;
 if transfer is null or auth.uid()<>(transfer->>'to')::uuid then raise exception 'Only the recipient can confirm receipt' using errcode='42501';end if;
 insert into public.trip_transfer_receipts(settlement_id,transfer_index,marked_by) values(p_settlement,p_index,auth.uid()) on conflict do nothing;
end;$$;
revoke all on function public.save_trip_expense(bigint,uuid,jsonb,boolean),public.expense_cycle_fingerprint(bigint),public.finalize_trip_settlement(bigint,text),public.mark_trip_transfer_paid(bigint,uuid,integer) from public,anon;
grant execute on function public.save_trip_expense(bigint,uuid,jsonb,boolean),public.expense_cycle_fingerprint(bigint),public.finalize_trip_settlement(bigint,text),public.mark_trip_transfer_paid(bigint,uuid,integer) to authenticated;
commit;
