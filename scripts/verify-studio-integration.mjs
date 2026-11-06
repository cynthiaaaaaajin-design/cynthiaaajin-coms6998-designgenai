// Isolated real PostgreSQL/RLS/RPC tests with deterministic fixtures, NOT live AI evidence.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {buildStepRequest} from '@tripsync/chain-runtime';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333';
const base='44444444-4444-4444-8444-444444444444';
await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select '{"app_metadata":{"provider":"google"}}'::jsonb$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
create table profiles(id uuid primary key,first_name text,last_name text);
create table trips(id bigint primary key,user_id uuid references profiles(id),title text,destination text,start_date date,end_date date);
create table trip_members(trip_id bigint references trips(id),user_id uuid references profiles(id),primary key(trip_id,user_id));
create table itinerary_versions(id uuid primary key default gen_random_uuid(),trip_id bigint not null references trips(id),version_number integer not null,parent_version_id uuid references itinerary_versions(id),created_by uuid references profiles(id),source text check(source in ('ai_initial','ai_revision','manual')),prompt_text text,response_text text,created_at timestamptz default now(),unique(trip_id,version_number));
create table itinerary_items(id uuid primary key default gen_random_uuid(),version_id uuid references itinerary_versions(id),day_number integer,position integer,start_time time,title text,description text,location text,origin text check(origin in ('ai','manual')),unique(version_id,day_number,position));
create table activity_votes(id bigint generated always as identity,item_id uuid references itinerary_items(id),user_id uuid references profiles(id),value integer,comment text);
insert into profiles values('${owner}','Test','Admin'),('${member}','Test','Member'),('${outsider}','Test','Outsider');
insert into auth.users(id,email) select id,first_name||id||'@example.test' from profiles;
insert into trips values(1,'${owner}','Integration test','Kyoto','2026-11-10','2026-11-11'),(2,'${outsider}','Other test','Tokyo','2026-11-10','2026-11-11');
insert into trip_members values(1,'${member}');
insert into itinerary_versions(id,trip_id,version_number,created_by,source,prompt_text) values('${base}',1,1,'${owner}','ai_initial','Test original prompt');
grant select on trips,trip_members,itinerary_versions,itinerary_items to authenticated;
alter table itinerary_versions enable row level security;alter table itinerary_items enable row level security;
`);
for(const file of ['trip-collaboration.sql','trip-phase3.sql','trip-publication-concurrency.sql','week6-community-admin.sql','chain-studio.sql','studio-integration.sql'])await db.exec(readFileSync(new URL('../sql/'+file,import.meta.url),'utf8'));
await db.exec(`update profiles set is_superadmin=true where id='${owner}';`);
await db.exec(`create policy version_read on itinerary_versions for select to authenticated using(collaboration_participant(trip_id,auth.uid()));create policy item_read on itinerary_items for select to authenticated using(exists(select 1 from itinerary_versions v where v.id=version_id));`);
const secret='isolated-fixture-secret-with-at-least-32-characters';
await db.query("update studio_integration_config set secret_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[secret]);
async function as(who,sql,args=[],role='authenticated'){await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who||'']);return db.query(sql,args);}
const rpc=async(who,action,data,key=secret)=>(await as(who,'select studio_gateway($1,$2,$3::jsonb) result',[key,action,JSON.stringify(data)])).rows[0].result;
const chain=(await as(owner,"select * from studio_chains where template_key='trip-planning'")).rows[0];
assert.equal(chain.steps.length,3);
assert.match(buildStepRequest('{{previous}}','original','actual output',1),/Original input:\noriginal/);
const activities=[1,2].map(day=>({day_number:day,position:0,start_time:null,title:`Day ${day}`,description:'Deterministic test fixture',location:'Kyoto'}));
const response=JSON.stringify({activities});
async function testAndPublish(c){
 const run=(await as(owner,'select to_jsonb(studio_begin_run($1,$2,$3)) result',[c.id,c.revision,JSON.stringify({destination:'Kyoto',start_date:'2026-11-10',end_date:'2026-11-11'})])).rows[0].result;
 for(let i=0;i<c.steps.length;i++)await as(owner,'select studio_record_run($1,$2,$3,null)',[run.id,i===c.steps.length-1?response:'Deterministic test fixture','fixture-model']);
 return (await as(owner,'select studio_publish_chain($1,$2,$3) id',[c.id,c.revision,run.id])).rows[0].id;
}
for(const who of [member,outsider]){
 assert.equal((await as(who,'select * from studio_chain_versions')).rows.length,0);
 await assert.rejects(()=>as(who,'select studio_publication_status()'));
 await assert.rejects(()=>as(who,'select studio_admin_generations(0)'));
 await assert.rejects(()=>rpc(who,'begin',{trip_id:'1',version_id:base,operation:'initial',input:'Test'},'wrong-secret'));
 await assert.rejects(()=>as(who,'select * from studio_integration_config'));
 await assert.rejects(()=>as(who,'select * from studio_trip_runs'));
}
await assert.rejects(()=>as(null,'select studio_admin_generations(0)',[],'anon'));
await assert.rejects(()=>rpc(outsider,'begin',{trip_id:'1',version_id:base,operation:'initial',input:'Test'}));
await assert.rejects(()=>rpc(member,'begin',{trip_id:'1',version_id:base,operation:'initial',input:'Test'}));
await assert.rejects(()=>rpc(owner,'begin',{trip_id:'1',version_id:base,operation:'initial',input:'Test'}),'No publication fails clearly');
const publication1=await testAndPublish(chain);
await assert.rejects(()=>as(member,'select studio_publish_chain($1,$2,$3)',[chain.id,1,publication1]));
const run=await rpc(owner,'begin',{trip_id:'1',version_id:base,operation:'initial',input:'Actual deterministic request'});
assert.equal(run.publication_id,publication1);assert.equal(run.snapshot.steps.length,3);
await assert.rejects(()=>rpc(owner,'begin',{trip_id:'1',version_id:base,operation:'initial',input:'Concurrent'}));
await assert.rejects(()=>rpc(owner,'finish',{id:run.id}));
await assert.rejects(()=>rpc(owner,'step',{id:run.id,step:2,text:'Wrong order'}));
for(let i=1;i<=3;i++)await rpc(owner,'step',{id:run.id,step:i,text:i===3?response:'fixture',model:'fixture',prompt:'resolved fixture',duration_ms:10});
// Force item failure to prove response/items/completed status are one transaction.
await db.exec('reset role');await db.exec("create function fail_fixture_insert() returns trigger language plpgsql as $$begin raise exception 'Fixture insertion failure';end$$;create trigger fail_fixture before insert on itinerary_items for each row execute function fail_fixture_insert();");
await assert.rejects(()=>rpc(owner,'finish',{id:run.id}));
await db.exec('reset role');assert.equal((await db.query('select response_text from itinerary_versions where id=$1',[base])).rows[0].response_text,null);
assert.equal((await db.query('select status from studio_trip_runs where id=$1',[run.id])).rows[0].status,'ready');
await db.exec('drop trigger fail_fixture on itinerary_items');
await rpc(owner,'finish',{id:run.id});
assert.equal((await as(owner,'select * from itinerary_items where version_id=$1',[base])).rows.length,2);
await assert.rejects(()=>rpc(owner,'finish',{id:run.id}),'Replay rejected');
await as(member,'select studio_rate_itinerary($1,4,$2)',[base,'Actual automated fixture feedback']);
await as(member,'select studio_rate_itinerary($1,5,$2)',[base,'Updated fixture feedback']);
const context=(await as(member,'select studio_itinerary_context($1) result',[base])).rows[0].result;
assert.equal(context.feedback.rating,5);assert.equal(context.generation.publication_id,publication1);assert(!JSON.stringify(context).includes('steps'));
await assert.rejects(()=>as(outsider,'select studio_rate_itinerary($1,5,$2)',[base,'Denied']));
await assert.rejects(()=>as(outsider,'select studio_itinerary_context($1)',[base]));
await assert.rejects(()=>as(member,'select studio_rate_itinerary($1,6,$2)',[base,'Invalid']));
// Draft edits cannot affect active immutable publication or historical run.
const changed=structuredClone(chain.steps);changed[1].prompt+=' Keep walks compact.';
await as(owner,'select studio_save_chain($1,1,$2,$3,$4::jsonb,false)',[chain.id,chain.name,chain.description,JSON.stringify(changed)]);
let current=(await as(owner,'select * from studio_chains where id=$1',[chain.id])).rows[0];
assert.equal((await as(owner,'select studio_publication_status() result')).rows[0].result.active_version_id,publication1);
const publication2=await testAndPublish(current);assert.notEqual(publication1,publication2);
assert.equal((await as(member,'select studio_itinerary_context($1) result',[base])).rows[0].result.generation.publication_id,publication1);
const proposalRun=await rpc(owner,'begin',{trip_id:'1',version_id:base,operation:'revision',input:'Revise while preserving constraints'});
assert.equal(proposalRun.publication_id,publication2);
const proposalResponse=JSON.stringify({activities,explanation:'Fixture revision',uncertainties:[]});
for(let i=1;i<=3;i++)await rpc(owner,'step',{id:proposalRun.id,step:i,text:i===3?proposalResponse:'fixture',model:'fixture',prompt:'fixture',duration_ms:5});
const snapshot=(await as(owner,'select trip_preference_snapshot(1) result')).rows[0].result;
const proposal=await rpc(owner,'proposal',{id:proposalRun.id,scope:'trip',instruction:'Fixture revision',snapshot,trip_context:{destination:'Kyoto',start_date:'2026-11-10',end_date:'2026-11-11'}});
const applied=(await as(owner,'select apply_itinerary_proposal(1,$1) id',[proposal.proposal_id])).rows[0].id;
assert.equal((await as(owner,'select studio_itinerary_context($1) result',[applied])).rows[0].result.generation.publication_id,publication2);
const admin=(await as(owner,'select studio_admin_generations(0) result')).rows[0].result;
assert.equal(admin.rows.find(r=>r.id===run.id).is_active,false);assert.equal(admin.rows.find(r=>r.id===run.id).rating_count,1);
assert.equal(admin.rows.find(r=>r.id===proposalRun.id).is_active,true);
if(process.env.VERIFY_REGIONAL==='1'){const {verifyRegional}=await import('./verify-regional-db.mjs');await verifyRegional({db,as,rpc,owner,member,base,testAndPublish});}
if(process.env.VERIFY_GROUP_DECISIONS==='1'){const {verifyGroupChain}=await import('./verify-tripsync3-chain-db.mjs');await verifyGroupChain({db,as,rpc,owner,secret});}
await db.close();
console.log('PASS: real isolated PostgreSQL publication/draft isolation, server+JWT gates, trip authorization, ordered execution, atomic completion rollback, immutable historical provenance, proposal apply linkage, feedback ownership/upsert and admin visibility. Deterministic fixtures; no live AI or deployment claims.');
