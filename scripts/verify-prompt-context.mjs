import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const db=new PGlite();
const admin='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function public.is_superadmin() returns boolean language sql stable as $$select auth.uid()='${admin}'::uuid$$;
grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
await db.exec(readFileSync(new URL('../sql/week7-observability.sql',import.meta.url),'utf8'));
async function as(who,sql,args=[],role='authenticated'){
 await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who||'']);return db.query(sql,args);
}
const list='select admin_observability_list($1,$2,$3) result';
const write='select admin_observability_write($1,$2,$3::jsonb,$4) id';
for(const who of [user,null]){
 await assert.rejects(()=>as(who,list,['terms','',0],who?'authenticated':'anon'));
 await assert.rejects(()=>as(who,write,['terms',null,'{"term":"x","definition":"y"}',false],who?'authenticated':'anon'));
}
await assert.rejects(()=>as(admin,'select * from admin_resources'));
async function save(resource,data,id=null,remove=false){return (await as(admin,write,[resource,id,JSON.stringify(data),remove])).rows[0].id;}
async function rows(resource,q='',page=0){return (await as(admin,list,[resource,q,page])).rows[0].result;}
for(const [resource,data] of Object.entries({terms:{term:'Travel',definition:'A trip'},'ai-generation-examples':{input:'Paris',output:'Museum'},'llm-providers':{name:'Test'},'allowed-signup-domains':{domain:'Example.edu'},'whitelisted-emails':{email:'User@Example.edu'}})){
 const id=await save(resource,data);assert.equal((await rows(resource)).rows.some(r=>r.id===id),true);
 await save(resource,{...data,notes:'Updated'},id);assert.equal((await rows(resource)).rows.find(r=>r.id===id).data.notes,'Updated');
 if(resource==='allowed-signup-domains')await assert.rejects(()=>save(resource,{domain:'example.edu'}));
 await save(resource,{},id,true);assert.equal((await rows(resource)).rows.some(r=>r.id===id),false);
}
await assert.rejects(()=>save('terms',{term:'Missing definition'}));
await assert.rejects(()=>save('llm-models',{name:'Invalid',provider_id:user,model_id:'x'}));
await assert.rejects(()=>save('allowed-signup-domains',{domain:'https://example.edu'}));
await assert.rejects(()=>save('whitelisted-emails',{email:'invalid'}));
await assert.rejects(()=>save('generation-requests',{status:'fake'}));
const mix=(await rows('prompt-chain-mix')).rows;
await assert.rejects(()=>save('prompt-chain-mix',mix[0].data));
await assert.rejects(()=>save('prompt-chain-mix',{...mix[0].data,weight:0},mix[0].id));
await save('prompt-chain-mix',{...mix[0].data,weight:2},mix[0].id);
const begin="select begin_observed_generation('itinerary','Traveler request') result";
const request=(await as(user,begin)).rows[0].result;assert.match(request.prompt,/Traveler request/);assert.equal(request.model,'deployment-default');
await assert.rejects(()=>as(admin,'select finish_observed_generation($1,$2,null)',[request.id,'Other user']));
await as(user,'select finish_observed_generation($1,$2,null)',[request.id,'{"activities":[]}']);
assert.equal((await rows('generation-requests')).rows[0].data.status,'succeeded');
assert.equal((await rows('llm-responses')).total,1);assert.equal((await rows('generated-media')).total,1);
await assert.rejects(()=>as(user,'select finish_observed_generation($1,$2,null)',[request.id,'Replay']));
const failed=(await as(user,begin)).rows[0].result;
await as(user,'select finish_observed_generation($1,$2,$3)',[failed.id,'partial','Model failed']);
assert.equal((await rows('generated-media')).total,1);assert.equal((await rows('llm-responses')).total,2);
for(let i=0;i<32;i++)await save('terms',{term:`Term ${i}`,definition:'Meaning'});
assert.equal((await rows('terms')).rows.length,30);assert.equal((await rows('terms','',1)).rows.length,2);assert.equal((await rows('terms','Term 31')).total,1);
await assert.rejects(()=>as(user,"insert into storage.objects(bucket_id,name) values('admin-images','blocked.png')"));
await as(admin,"insert into storage.objects(bucket_id,name) values('admin-images','test.png')");
const image=await save('images',{title:'Test',path:'test.png'});await save('images',{title:'New title',path:'test.png'},image);await save('images',{},image,true);
await assert.rejects(()=>save('images',{title:'Missing',path:'missing.png'}));
assert.equal((await as(user,'select * from storage.objects')).rows.length,0);
for(const entry of mix) await save('prompt-chain-mix',{...entry.data,enabled:false},entry.id);
await assert.rejects(()=>as(user,begin));

for(const entry of mix) await save('prompt-chain-mix',{...entry.data,enabled:true},entry.id);
await db.exec('reset role');
await db.exec(readFileSync(new URL('../sql/tripsync-prompt-context.sql',import.meta.url),'utf8'));
const enriched=(await as(user,begin)).rows[0].result;
assert.match(enriched.prompt,/Hard constraint/);assert.match(enriched.prompt,/A gentle Baixa/);assert(!enriched.prompt.includes('An indoor afternoon at the museum'));
const audit=(await rows('generation-requests',enriched.id)).rows[0].data;
assert.equal(audit.reference_terms.length,5);assert.equal(audit.reference_examples.length,1);assert(audit.chain_name);
const proposal=(await as(user,"select begin_observed_generation('proposal','Replace only one activity') result")).rows[0].result;
assert.match(proposal.prompt,/An indoor afternoon at the museum/);assert(!proposal.prompt.includes('A gentle Baixa'));
const term=(await rows('terms','Hard constraint')).rows[0];
await save('terms',{...term.data,definition:'Updated requirement meaning'},term.id);
assert.match((await as(user,begin)).rows[0].result.prompt,/Updated requirement meaning/);
await save('terms',{...term.data,enabled:false},term.id);
assert(!(await as(user,begin)).rows[0].result.prompt.includes('Updated requirement meaning'));
const variant=(await rows('prompt-chain-mix')).rows.find(r=>r.data.chain_id==='a7330000-0000-4000-8000-000000000201');
const itineraryChain=(await rows('prompt-chains','itinerary')).rows.find(c=>c.data.name==='itinerary');
const original=(await rows('prompt-chain-mix')).rows.find(r=>r.data.chain_id===itineraryChain.id);
await save('prompt-chain-mix',{...original.data,enabled:false},original.id);
assert.match((await as(user,begin)).rows[0].result.prompt,/reduce unnecessary cross-city transfers/);
await save('prompt-chain-mix',{...variant.data,enabled:false},variant.id);
await assert.rejects(()=>as(user,begin));
await save('prompt-chain-mix',{...original.data,enabled:true},original.id);
assert(!(await as(user,begin)).rows[0].result.prompt.includes('reduce unnecessary cross-city transfers'));
await db.exec('reset role');
await db.query("insert into admin_resources(resource,data) select 'prompt-chain-steps',data from admin_resources where resource='prompt-chain-steps' and data->>'chain_id'=$1",[original.data.chain_id]);
await assert.rejects(()=>as(user,begin));
console.log('PASS prompt context: seeded references, kind isolation, live glossary updates, disabled-reference exclusion, audit snapshots, alternate chain routing, no-chain failure and unsupported multi-step rejection. Isolated database; no model calls.');
await db.close();
