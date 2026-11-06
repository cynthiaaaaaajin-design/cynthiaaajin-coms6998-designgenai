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

for(const file of ['tripsync3-preferences.sql','tripsync3-publication-context.sql','tripsync3-decisions.sql'])await db.exec(readFileSync(new URL('../sql/'+file,import.meta.url),'utf8'));
const {randomUUID}=await import('node:crypto');
const state=async id=>(await as(owner,'select decision_round_state($1) s',[id])).rows[0].s;

await as(owner,`insert into trip_preferences(trip_id,user_id,budget_amount,budget_currency,budget_scope,travel_pace,activity_choices,dietary_restrictions,preferred_transportation,availability_start,availability_end) values(1,$1,100,'EUR','per_person_day','relaxed','{"museums":"must"}','{Vegetarian}','{Train}','2026-10-10','2026-10-11')`,[owner]);
await as(member,`insert into trip_preferences(trip_id,user_id,budget_amount,budget_currency,budget_scope,travel_pace,activity_choices) values(1,$1,200,'EUR','per_person_day','packed','{"museums":"avoid"}')`,[member]);
assert.equal((await as(member,"update trip_preferences set activity_choices='{}' where user_id=$1 returning id",[owner])).rows.length,0);
await denied(owner,"update trip_preferences set activity_choices='{\"invalid\":\"must\"}' where user_id=$1",[owner]);
await denied(owner,"update trip_preferences set activity_choices='{\"museums\":null}' where user_id=$1",[owner]);
async function create(baseId=base,rule='unanimous',deadline=null){const id=randomUUID(),options=[{id:randomUUID(),label:'Together',instruction:'Keep restrictions; optional museum for those who want it.'},{id:randomUUID(),label:'Alternative',instruction:'Use a different shared activity, with optional personal museum time.'}];await as(owner,'select create_trip_decision(\'test-secret\',1,$1,$2,\'Museum discussion\',$3::jsonb,\'day\',1,$4,$5,$6::jsonb)',[id,baseId,JSON.stringify({source:'member',kind:'question',title:'Museum discussion',evidence:[]}),rule,deadline,JSON.stringify(options)]);return {id,options};}
async function generate(round,option,baseId=base){const token=randomUUID();await as(owner,"select claim_decision_option('test-secret',$1,$2,$3)",[round.id,option.id,token]);const d=await state(round.id);const body={activities:[{day_number:1,position:0,start_time:'11:00',title:option.label+' garden',description:'Museum participation is optional; restrictions preserved.',location:'Paris'}],explanation:'Supports both submitted positions through optional participation. Restrictions remain binding.',uncertainties:['Verify meeting point and venue hours.']};
 const ctx={...d.trip_context,source_action:'group_decision',group_decision:{round_id:round.id,option_id:option.id,token}};
 const proposal=(await as(owner,'select save_itinerary_proposal(1,$1,\'day\',1,null,$2,\'Fixture model output, not a real AI call\',$3,$4::jsonb,$5::jsonb) id',[baseId,option.instruction,JSON.stringify(body),JSON.stringify(d.preference_snapshot),JSON.stringify(ctx)])).rows[0].id;
 const raw=(await as(owner,'select trip_context from itinerary_proposals where id=$1',[proposal])).rows[0];assert.equal('token' in raw.trip_context.group_decision,false,'Generation lease never persisted in readable context');await as(owner,'select review_decision_option($1,$2,true)',[round.id,option.id]);return proposal;}
const round=await create();
await denied(outsider,'select decision_round_state($1)',[round.id],'42501');
await denied(owner,'insert into trip_decision_votes values($1,$2,$3,now())',[round.id,owner,round.options[0].id],'42501');
await denied(member,'select vote_trip_decision($1,$2)',[round.id,round.options[0].id],'40001');
const proposalA=await generate(round,round.options[0]);assert.equal((await state(round.id)).state,'preparing');
await denied(owner,'select apply_itinerary_proposal(1,$1)',[proposalA],'42501');
assert.equal((await as(owner,'select * from itinerary_versions')).rows.length,1,'Rejected legacy apply rolls back the new version and items');
await generate(round,round.options[1]);assert.equal((await state(round.id)).state,'voting');
await denied(outsider,'select vote_trip_decision($1,$2)',[round.id,round.options[0].id],'42501');
await as(owner,'select vote_trip_decision($1,$2)',[round.id,round.options[0].id]);await as(owner,'select vote_trip_decision($1,$2)',[round.id,round.options[0].id]);assert.equal((await state(round.id)).votes_received,1);
await as(member,'select vote_trip_decision($1,$2)',[round.id,round.options[1].id]);assert.equal((await state(round.id)).decision_met,false,'Split votes are not unanimity');
await as(member,'select vote_trip_decision($1,$2)',[round.id,round.options[0].id]);let d=await state(round.id);assert.equal(d.decision_met,true);assert.equal(d.threshold,2);assert.equal(d.votes.length,2);
await denied(owner,'select apply_itinerary_proposal(1,$1)',[proposalA],'42501');await denied(member,'select apply_trip_decision($1,$2,true)',[round.id,round.options[0].id],'42501');await denied(owner,'select apply_trip_decision($1,$2,false)',[round.id,round.options[0].id],'42501');await denied(owner,'select apply_trip_decision($1,$2,true)',[round.id,round.options[1].id],'40001');
const applied=(await as(owner,'select apply_trip_decision($1,$2,true) id',[round.id,round.options[0].id])).rows[0].id;
d=await state(round.id);assert.equal(d.state,'applied');assert.equal(d.applied_version_id,applied);assert.equal(d.decision_snapshot.votes.length,2);assert.equal(d.decision_snapshot.winner_id,round.options[0].id);
const v=(await as(owner,'select * from itinerary_versions where id=$1',[applied])).rows[0];assert.equal(v.parent_version_id,base);assert.equal(v.source,'ai_revision');
const untouched=(await as(owner,'select title from itinerary_items where version_id=$1 and day_number=2',[applied])).rows[0];assert.equal(untouched.title,'Lunch');assert.equal((await as(owner,'select * from itinerary_items where version_id=$1',[base])).rows.length,2);
await denied(member,'select vote_trip_decision($1,$2)',[round.id,round.options[1].id],'40001');
const third='99999999-9999-4999-8999-999999999999';await db.exec(`reset role;insert into profiles values('${third}','Third','Member');insert into trip_members values(1,'${third}');`);
const majority=await create(applied,'majority');await generate(majority,majority.options[0],applied);await generate(majority,majority.options[1],applied);
await as(owner,'select vote_trip_decision($1,$2)',[majority.id,majority.options[0].id]);assert.equal((await state(majority.id)).decision_met,false);await as(member,'select vote_trip_decision($1,$2)',[majority.id,majority.options[0].id]);assert.equal((await state(majority.id)).decision_met,true);assert.equal((await state(majority.id)).threshold,2);
await as(member,"update trip_preferences set budget_amount=250 where trip_id=1 and user_id=$1",[member]);assert.equal((await state(majority.id)).stale,true);await denied(owner,'select apply_trip_decision($1,$2,true)',[majority.id,majority.options[0].id],'40001');
const fresh=await create(applied);await generate(fresh,fresh.options[0],applied);await generate(fresh,fresh.options[1],applied);await db.exec(`reset role;update trip_decisions set deadline=now()-interval '1 minute' where id='${fresh.id}';`);await denied(owner,'select vote_trip_decision($1,$2)',[fresh.id,fresh.options[0].id],'40001');assert.equal((await state(fresh.id)).expired,true);
const reservationRound=await create(applied);await as(owner,"insert into trip_reservations(trip_id,created_by,kind,status,details) values(1,$1,'hotel','planned','{}')",[owner]);assert.equal((await state(reservationRound.id)).stale,true);
const memberRound=await create(applied);await db.exec(`reset role;delete from trip_members where trip_id=1 and user_id='${third}';`);assert.equal((await state(memberRound.id)).stale,true);
assert.equal((await as(outsider,'select * from trip_decisions')).rows.length,0);assert.equal((await as(outsider,'select * from trip_decision_votes')).rows.length,0);
await denied(owner,'select generation_token from trip_decision_options',[],'42501');
assert.equal((await state(round.id)).decision_snapshot.votes.length,2,'Historical decision survives membership/preferences changes');
const summaries=(await as(owner,'select list_trip_decisions(1) rounds')).rows[0].rounds;assert.ok(summaries.length>=4);assert.equal('preference_snapshot' in summaries[0],false);assert.equal(summaries[0].options[0].response_text,null);
console.log('PASS TripSync 3 PostgreSQL: shared own-only preferences, atomic candidate links, hidden leases, no duplicate votes, unanimity/ties, strict majority, old-apply bypass rollback, owner confirmation, parent preservation, frozen votes, stale preferences/reservations/membership, deadlines and nonmember isolation. Fixtures only; no fabricated live member participation.');
await db.close();
