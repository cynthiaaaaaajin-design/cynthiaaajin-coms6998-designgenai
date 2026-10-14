// Actual PostgreSQL functions, grants and RLS on an isolated representative schema. No live Supabase writes.
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
const original=[{source_item_id:item,day_number:1,position:0,start_time:'09:00',title:'Museum',description:'Art',location:'Paris'}, {source_item_id:item2,day_number:2,position:0,start_time:'12:00',title:'Lunch',description:'Food',location:'Paris'}];
const save='select save_manual_itinerary(1,$1,$2::jsonb) id';
for(const who of [null,outsider])await denied(who,save,[base,JSON.stringify(original)],'42501');
await assert.rejects(()=>as(null,save,[base,JSON.stringify(original)],'anon'));
await denied(member,'select publish_trip_draft(1,$1,$2::jsonb,null)',[base,JSON.stringify(original)],'42501');
await denied(member,"insert into itinerary_versions(trip_id,version_number,source) values(1,2,'manual')",[],'42501');
for(const bad of [[],[{...original[0],day_number:3}],[{...original[0],position:1}],[{...original[0],title:''}],[{...original[0],start_time:'25:00'}],[{...original[0],source_item_id:outsider}],[original[0],{...original[0],position:1}]]) await denied(member,save,[base,JSON.stringify(bad)]);
assert.equal((await as(owner,'select * from itinerary_versions')).rows.length,1,'Validation failure creates no version');
await as(member,"insert into activity_change_requests(trip_id,version_id,item_id,created_by,request_type,comment) values(1,$1,$2,$3,'too_expensive','Cheaper please')",[base,item,member]);
const draft=[{...original[1],day_number:1,position:0,start_time:'13:00'},{source_item_id:null,day_number:1,position:1,start_time:null,title:'Waterfront',description:null,location:'Paris'}];
const manual=(await as(member,save,[base,JSON.stringify(draft)])).rows[0].id;
let version=(await as(owner,'select * from itinerary_versions where id=$1',[manual])).rows[0];
assert.equal(version.source,'manual');assert.equal(version.created_by,member);assert.equal(version.parent_version_id,base);
const manualItems=(await as(owner,'select * from itinerary_items where version_id=$1 order by day_number,position',[manual])).rows;
assert.equal(manualItems.length,2);assert.equal(manualItems[0].origin,'manual');assert.equal(manualItems[1].origin,'manual');
assert.equal((await as(owner,'select * from itinerary_items where version_id=$1',[base])).rows.length,2,'Old items intact');
await denied(owner,save,[base,JSON.stringify(original)],'40001');
const trip={destination:'Paris',start_date:'2026-10-10',end_date:'2026-10-11'};
let snapshot=(await as(member,'select trip_preference_snapshot(1) snapshot')).rows[0].snapshot;
const body={activities:[{day_number:1,position:0,start_time:'15:00',title:'Cheaper cafe',description:'Check prices',location:'Paris'}],explanation:'Less expensive alternative; hours unverified.',uncertainties:['Prices not verified']};
const proposalSQL='select save_itinerary_proposal(1,$1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) id';
const proposalArgs=(b=body,scope='activity',baseId=manual,target=manualItems[0].id,snap=snapshot)=>[baseId,scope,scope==='trip'?null:1,scope==='activity'?target:null,'Find cheaper option','exact AI prompt',JSON.stringify(b),JSON.stringify(snap),JSON.stringify(trip)];
await denied(member,proposalSQL,proposalArgs(body,'trip'),'42501');
await denied(outsider,proposalSQL,proposalArgs(),'42501');
await denied(member,proposalSQL,proposalArgs({...body,activities:[{...body.activities[0],day_number:2}]}));
await denied(member,proposalSQL,proposalArgs(body,'activity',manual,item2));
const proposal=(await as(member,proposalSQL,proposalArgs())).rows[0].id;
assert.equal((await as(owner,'select * from itinerary_versions')).rows.length,2,'Generating a proposal never publishes');
assert.equal((await as(owner,'select * from itinerary_proposals')).rows.length,1,'Owner can review member proposal');
assert.equal((await as(outsider,'select * from itinerary_proposals')).rows.length,0,'Outsider cannot read proposal');
await denied(member,"update itinerary_proposals set response_text='forged' where id=$1",[proposal],'42501');
await denied(member,'select apply_itinerary_proposal(1,$1)',[proposal],'42501');
const applied=(await as(owner,'select apply_itinerary_proposal(1,$1) id',[proposal])).rows[0].id;
version=(await as(owner,'select * from itinerary_versions where id=$1',[applied])).rows[0];
assert.equal(version.source,'ai_revision');assert.equal(version.parent_version_id,manual);assert.equal(version.prompt_text,'exact AI prompt');assert.equal(version.response_text,JSON.stringify(body));assert.deepEqual(version.preference_snapshot,snapshot);
const appliedItems=(await as(owner,'select * from itinerary_items where version_id=$1 order by day_number,position',[applied])).rows;
assert.equal(appliedItems[0].title,'Cheaper cafe');assert.equal(appliedItems[0].origin,'ai');assert.equal(appliedItems[1].title,manualItems[1].title);assert.equal(appliedItems[1].origin,'manual');assert.notEqual(appliedItems[1].id,manualItems[1].id);
await denied(owner,'select apply_itinerary_proposal(1,$1)',[proposal],'40001');
const dayBody={...body,activities:[{...body.activities[0],title:'New day plan'}]};
const dayProposal=(await as(member,proposalSQL,proposalArgs(dayBody,'day',applied,null))).rows[0].id;
// Changes during AI review invalidate the proposal, while the current itinerary remains untouched.
await as(member,"insert into trip_preferences(trip_id,user_id,budget_currency,budget_scope,travel_pace) values(1,$1,'EUR','per_person_day','relaxed')",[member]);
await denied(owner,'select apply_itinerary_proposal(1,$1)',[dayProposal],'P3001');
let fresh=(await as(owner,'select trip_preference_snapshot(1) snapshot')).rows[0].snapshot;
assert.notDeepEqual(fresh,snapshot);
await as(member,"update trip_preferences set travel_pace='relaxed' where user_id=$1",[member]);
assert.deepEqual((await as(owner,'select trip_preference_snapshot(1) snapshot')).rows[0].snapshot,fresh,'No-op preference save does not produce a false change');
snapshot=fresh;
const full={...body,activities:[body.activities[0],{...body.activities[0],day_number:2,title:'Second day'}]};
const fullProposal=(await as(owner,proposalSQL,proposalArgs(full,'trip',applied,null))).rows[0].id;
const regenerated=(await as(owner,'select apply_itinerary_proposal(1,$1) id',[fullProposal])).rows[0].id;
assert.equal((await as(owner,'select * from itinerary_items where version_id=$1',[regenerated])).rows.length,2);
// All proposal scopes reject the same stale base and retain their proposal records.
const currentItems=(await as(owner,'select * from itinerary_items where version_id=$1 order by day_number,position',[regenerated])).rows;
const partialPending=(await as(member,proposalSQL,proposalArgs(body,'activity',regenerated,currentItems[0].id))).rows[0].id;
const fullPending=(await as(owner,proposalSQL,proposalArgs(full,'trip',regenerated,null))).rows[0].id;
await denied(member,'select apply_itinerary_proposal(1,$1)',[fullPending],'42501');
const newer=(await as(member,save,[regenerated,JSON.stringify([{...body.activities[0],source_item_id:null,title:'Member draft wins'}])])).rows[0].id;
const conflictMessage='This itinerary has been updated by another traveler. Please review the latest version before applying your changes.';
for(const pendingId of [partialPending,fullPending]) {
 await assert.rejects(()=>as(owner,'select apply_itinerary_proposal(1,$1)',[pendingId]),e=>{assert.equal(e.code,'40001');assert.equal(e.message,conflictMessage);return true;});
 assert.equal((await as(owner,'select applied_version_id from itinerary_proposals where id=$1',[pendingId])).rows[0].applied_version_id,null);
}
await assert.rejects(()=>as(owner,save,[regenerated,JSON.stringify([{...body.activities[0],source_item_id:null}])]),e=>{assert.equal(e.message,conflictMessage);return true;});
// A full-regeneration preview also becomes invalid when group preferences change.
const outdatedFull=(await as(owner,proposalSQL,proposalArgs(full,'trip',newer,null))).rows[0].id;
await as(member,"update trip_preferences set travel_pace='packed' where user_id=$1",[member]);
await denied(owner,'select apply_itinerary_proposal(1,$1)',[outdatedFull],'P3001');
assert.equal((await as(owner,'select applied_version_id from itinerary_proposals where id=$1',[outdatedFull])).rows[0].applied_version_id,null);
assert.equal((await as(owner,'select current_published_itinerary(1) state')).rows[0].state.id,newer);
// An empty failed attempt is not a publication; its version number remains reserved.
await db.exec('reset role');
await db.query("insert into itinerary_versions(trip_id,version_number,created_by,source) select 1,max(version_number)+1,$1,'ai_revision' from itinerary_versions where trip_id=1",[owner]);
const reserved=(await as(owner,'select max(version_number) n from itinerary_versions where trip_id=1')).rows[0].n;
assert.equal((await as(owner,'select current_published_itinerary(1) state')).rows[0].state.id,newer);
const afterFailure=(await as(owner,save,[newer,JSON.stringify([{...body.activities[0],source_item_id:null,title:'Preserve failed history'}])])).rows[0].id;
assert.equal((await as(owner,'select version_number from itinerary_versions where id=$1',[afterFailure])).rows[0].version_number,reserved+1);
// Force an INSERT failure after the version is inserted: the entire RPC must roll back.
await db.exec('reset role');
await db.exec("create function fail_test_insert() returns trigger language plpgsql as $$begin if new.title='FAIL INSERT' then raise exception 'test failure'; end if; return new; end$$;create trigger fail_test_insert before insert on itinerary_items for each row execute function fail_test_insert();");
const countBefore=(await as(owner,'select count(*) count from itinerary_versions')).rows[0].count;
await denied(member,save,[afterFailure,JSON.stringify([{...body.activities[0],title:'FAIL INSERT',source_item_id:null}])]);
assert.equal((await as(owner,'select count(*) count from itinerary_versions')).rows[0].count,countBefore,'Insertion failure rolls back the new version');
await db.exec('reset role');await db.exec(`delete from trip_members where user_id='${member}'`);
await denied(member,save,[regenerated,JSON.stringify([{...body.activities[0],source_item_id:null}])],'42501');
await denied(member,proposalSQL,proposalArgs(full,'day',regenerated,null),'42501');
assert.equal((await as(member,'select * from itinerary_proposals')).rows.length,0);
await db.exec('reset role');
assert.equal((await db.query('select * from activity_votes')).rows.length,1,'Votes unchanged');
assert.equal((await db.query('select status from activity_change_requests')).rows[0].status,'pending','New versions never automatically resolve suggestions');
assert.equal((await db.query('select prompt_text from itinerary_versions where id=$1',[base])).rows[0].prompt_text,'original prompt','Original metadata unchanged');
await db.close();
console.log('PASS Phase 3 PostgreSQL: atomic manual versions, owner/member grants, field/order/source validation, stale drafts, immutable shared proposals, scope bounds, owner-only application, exact AI audit/snapshot, full regeneration, preference invalidation, rollback and removed-member denial. Isolated database only.');
