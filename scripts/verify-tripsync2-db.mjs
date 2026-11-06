// TripSync 2 migrations run on isolated PostgreSQL with real RLS and RPC execution.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333';
const base='44444444-4444-4444-8444-444444444444',item='55555555-5555-4555-8555-555555555555',item2='66666666-6666-4666-8666-666666666666';
await db.exec(`
create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
create table profiles(id uuid primary key,first_name text,last_name text);
create table trips(id bigint primary key,user_id uuid references profiles(id),destination text,start_date date,end_date date);
create table trip_members(trip_id bigint references trips(id),user_id uuid references profiles(id),primary key(trip_id,user_id));
create table itinerary_versions(id uuid primary key default gen_random_uuid(),trip_id bigint not null references trips(id),version_number integer not null,parent_version_id uuid references itinerary_versions(id),created_by uuid references profiles(id),source text check(source in ('ai_initial','ai_revision','manual')),prompt_text text,response_text text,created_at timestamptz default now(),unique(trip_id,version_number));
create table itinerary_items(id uuid primary key default gen_random_uuid(),version_id uuid references itinerary_versions(id),day_number integer,position integer,start_time time,title text,description text,location text,origin text check(origin in ('ai','manual')),unique(version_id,day_number,position));
create table activity_votes(id bigint generated always as identity,item_id uuid references itinerary_items(id),user_id uuid references profiles(id),value integer,comment text);
insert into profiles values('${owner}','Owner','Traveler'),('${member}','Member','Traveler'),('${outsider}','Other','Traveler');
insert into trips values(1,'${owner}','Paris','2026-10-10','2026-10-11'),(2,'${outsider}','Tokyo','2026-10-10','2026-10-11');
insert into trip_members values(1,'${member}');
insert into itinerary_versions(id,trip_id,version_number,created_by,source,prompt_text,response_text) values('${base}',1,1,'${owner}','ai_initial','original prompt','original response');
insert into itinerary_items(id,version_id,day_number,position,start_time,title,description,location,origin) values('${item}','${base}',1,0,'09:00','Museum','Art','Paris','ai'),('${item2}','${base}',2,0,'12:00','Lunch','Food','Paris','ai');
insert into activity_votes(item_id,user_id,value,comment) values('${item}','${member}',1,'Keep art');
grant select on trips,trip_members,itinerary_versions,itinerary_items to authenticated;
alter table itinerary_versions enable row level security;
alter table itinerary_items enable row level security;
`);
await db.exec(readFileSync(new URL('../sql/trip-collaboration.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../sql/trip-phase3.sql',import.meta.url),'utf8'));
// Upgrade patch is repeatable on an existing installation.
for(let i=0;i<2;i++) await db.exec(readFileSync(new URL('../sql/trip-publication-concurrency.sql',import.meta.url),'utf8'));
await db.exec(`create policy version_read on itinerary_versions for select to authenticated using(collaboration_participant(trip_id,auth.uid()));
create policy item_read on itinerary_items for select to authenticated using(exists(select 1 from itinerary_versions v where v.id=version_id));`);
async function as(user,sql,params=[],role='authenticated') {
 await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);return db.query(sql,params);
}
async function denied(user,sql,params=[],code) {
 await assert.rejects(()=>as(user,sql,params),e=>{if(code)assert.equal(e.code,code);return true;});
}

await db.exec(`create function public.studio_gateway(p_secret text,p_action text,p_data jsonb) returns jsonb language plpgsql as $$begin if p_secret is distinct from 'test-secret' then raise exception 'Unauthorized' using errcode='42501';end if;return '{}'::jsonb;end;$$;`);
for(const file of ['tripsync2-copilot.sql','tripsync2-reservations.sql','tripsync2-reservation-concurrency.sql','tripsync2-expenses.sql'])await db.exec(readFileSync(new URL('../sql/'+file,import.meta.url),'utf8'));
const req='77777777-7777-4777-8777-777777777777';
await denied(outsider,"select copilot_message('test-secret',1,$1,'Hello',$2)",[req,base],'42501');
const chat=(await as(owner,"select copilot_message('test-secret',1,$1,'Hello',$2) m",[req,base])).rows[0].m;
assert.equal((await as(owner,"select copilot_message('test-secret',1,$1,'Hello',$2) m",[req,base])).rows[0].m.id,chat.id);
await denied(owner,"select copilot_message('test-secret',1,$1,'Different',$2)",[req,base],'40001');
assert.equal((await as(outsider,'select * from trip_chat_messages')).rows.length,0);
await denied(owner,"insert into trip_chat_messages(trip_id,author_id,request_id,content) values(1,$1,$2,'fake')",[owner,req],'42501');
const booking=(await as(member,"insert into trip_reservations(trip_id,created_by,kind,status,details) values(1,$1,'hotel','planned','{}') returning id",[member])).rows[0].id;
assert.equal((await as(outsider,'select * from trip_reservations')).rows.length,0);
assert.equal((await as(outsider,"update trip_reservations set status='booked' where id=$1 returning id",[booking])).rows.length,0);
const pref=(await as(owner,'select trip_preference_snapshot(1) s')).rows[0].s;
const reservationSnapshot=(await as(owner,'select trip_reservation_snapshot(1) s')).rows[0].s;
const revision={activities:[{day_number:2,position:0,start_time:'14:00',title:'Cafe',description:null,location:'Paris'}],explanation:'Relaxed Day 2',uncertainties:[]};
const proposal=(await as(owner,'select save_itinerary_proposal(1,$1,\'day\',2,null,\'Relax\',\'Prompt\',$2,$3::jsonb,$4::jsonb) id',[base,JSON.stringify(revision),JSON.stringify(pref),JSON.stringify({destination:'Paris',start_date:'2026-10-10',end_date:'2026-10-11',reservations:reservationSnapshot})])).rows[0].id;
await as(member,"update trip_reservations set status='booked' where id=$1",[booking]);
await denied(owner,'select apply_itinerary_proposal(1,$1)',[proposal],'P3001');
const values=[
 {id:'81111111-1111-4111-8111-111111111111',description:'Dinner',amount:6000,currency:'EUR',payer_id:owner,allocations:[{user_id:owner,amount:3000},{user_id:member,amount:3000}]},
 {id:'82222222-2222-4222-8222-222222222222',description:'Ride',amount:9000,currency:'EUR',payer_id:member,allocations:[{user_id:owner,amount:4500},{user_id:member,amount:4500}]},
 {id:'83333333-3333-4333-8333-333333333333',description:'USD',amount:1001,currency:'USD',payer_id:owner,allocations:[{user_id:owner,amount:501},{user_id:member,amount:500}]}
];
const save='select save_trip_expense(1,$1,$2::jsonb) id';
for(const v of values)await as(owner,save,[v.id,JSON.stringify({...v,split_method:'custom',expense_date:'2026-11-06',category:'Other'})]);
await denied(outsider,save,[values[0].id,JSON.stringify(values[0])],'42501');
await denied(owner,save,['84444444-4444-4444-8444-444444444444',JSON.stringify({...values[0],allocations:[{user_id:owner,amount:5999}],split_method:'custom',expense_date:'2026-11-06',category:'Other'})]);
assert.equal((await as(outsider,'select * from trip_expenses')).rows.length,0);
const fp=(await as(owner,'select expense_cycle_fingerprint(1) f')).rows[0].f;
await denied(member,'select finalize_trip_settlement(1,$1)',[fp],'42501');
await denied(owner,"select finalize_trip_settlement(1,'stale')",[],'40001');
const snap=(await as(owner,'select finalize_trip_settlement(1,$1) id',[fp])).rows[0].id;
const saved=(await as(owner,'select * from trip_settlements where id=$1',[snap])).rows[0];
assert.deepEqual(saved.transfers,[{from:owner,to:member,amount:1500,currency:'EUR'},{from:member,to:owner,amount:500,currency:'USD'}]);
await denied(owner,"select save_trip_expense(1,$1,'{}',true)",[values[0].id],'40001');
await denied(owner,'select mark_trip_transfer_paid(1,$1,0)',[snap],'42501');
await as(member,'select mark_trip_transfer_paid(1,$1,0)',[snap]);
assert.equal((await as(owner,'select * from trip_transfer_receipts')).rows.length,1);
const extra={...values[0],id:'85555555-5555-4555-8555-555555555555'};
await as(owner,save,[extra.id,JSON.stringify({...extra,split_method:'equal',expense_date:'2026-11-06',category:'Other'})]);
assert.equal((await as(owner,'select * from trip_expenses where settlement_id is null')).rows.length,1);
assert.equal((await as(owner,'select * from trip_settlements')).rows.length,1);
console.log('PASS TripSync 2 PostgreSQL: additive migrations, member isolation, chat idempotency, direct assistant-write denial, reservation isolation, exact multicurrency settlement, stale-preview rejection, owner finalization, recipient receipts and immutable settlement cycles. Isolated database only.');
await db.close();
