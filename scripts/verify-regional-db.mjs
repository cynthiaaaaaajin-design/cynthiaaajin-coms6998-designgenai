import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export async function verifyRegional({db,as,rpc,owner,member,base}){
 await db.exec('reset role');
 const old=(await db.query('select active_version_id from studio_integration_config')).rows[0].active_version_id;
 const history=(await db.query('select id,publication_id,outputs from studio_trip_runs order by id')).rows;
 await db.exec(readFileSync(new URL('../sql/studio-regional-routing.sql',import.meta.url),'utf8'));
 const config=async(data=null,enabled=null)=>(await as(owner,'select studio_routing_config($1::jsonb,$2) result',[data&&JSON.stringify(data),enabled])).rows[0].result;
 const preview=async(code,status='resolved')=>(await as(owner,'select studio_routing_preview($1::jsonb) result',[JSON.stringify({status,country_code:code,destination:'Fixture',source:'reviewed_alias',reason:'unknown_destination'})])).rows[0].result;
 let state=await config();assert.equal(state.enabled,false);assert.equal(state.rules.length,4);
 const templates=(await as(owner,"select * from studio_chains where template_key like 'regional-%'")).rows;
 assert.equal(templates.length,3);assert(templates.every(c=>c.steps.length===3&&c.output_contract==='itinerary'));
 for(const who of [member,null]){
  await assert.rejects(()=>as(who,'select studio_routing_config()',[],who?'authenticated':'anon'));
  await assert.rejects(()=>as(who,'select studio_routing_preview($1::jsonb)',[JSON.stringify({country_code:'FR'})],who?'authenticated':'anon'));
  await assert.rejects(()=>as(who,'select studio_select_route($1::jsonb)', ['{}'],who?'authenticated':'anon'));
 }
 assert.equal((await preview('FR')).publication_id,old);assert.equal((await preview('FR')).fallback,true);
 const published={};
 for(const c of templates){
  const test=(await as(owner,'select to_jsonb(studio_begin_run($1,$2,$3)) result',[c.id,c.revision,JSON.stringify({destination:'Kyoto',start_date:'2026-11-10',end_date:'2026-11-11'})])).rows[0].result;
  for(let i=0;i<3;i++)await as(owner,'select studio_record_run($1,$2,$3,null)',[test.id,i===2?JSON.stringify({activities:[1,2].map(day=>({day_number:day,position:0,start_time:null,title:'Fixture',description:'Isolated fixture',location:'Fixture'}))}):'Fixture','fixture']);
  await assert.rejects(()=>as(member,'select studio_publish_regional_chain($1,$2,$3)',[c.id,c.revision,test.id]));
  published[c.template_key]=(await as(owner,'select studio_publish_regional_chain($1,$2,$3) id',[c.id,c.revision,test.id])).rows[0].id;
 }
 const edited=structuredClone(templates[0].steps);edited[1].prompt+=' Keep this draft private until publication.';
 await as(owner,'select studio_save_chain($1,$2,$3,$4,$5::jsonb,false)',[templates[0].id,templates[0].revision,templates[0].name,templates[0].description,JSON.stringify(edited)]);
 await db.exec('reset role');
 assert.deepEqual((await db.query('select snapshot from studio_chain_versions where id=$1',[published[templates[0].template_key]])).rows[0].snapshot.steps,templates[0].steps);
 const migration=readFileSync(new URL('../sql/studio-regional-routing.sql',import.meta.url),'utf8');
 const seed=migration.slice(migration.indexOf('do $$'),migration.indexOf('revoke all on function public.studio_publish_regional_chain'));
 await db.exec(seed);
 assert.equal((await db.query("select count(*) n from studio_chains where template_key like 'regional-%'")).rows[0].n,3);
 assert.deepEqual((await db.query('select steps from studio_chains where id=$1',[templates[0].id])).rows[0].steps,edited);
 state=await config();assert.equal(state.heads.length,4);
 for(const [ruleKey,templateKey] of [['europe','regional-europe'],['north-america','regional-north-america'],['china','regional-china']]){
  const r=state.rules.find(r=>r.rule_key===ruleKey);await config({...r,enabled:true,chain_id:templates.find(t=>t.template_key===templateKey).id});
 }
 for(const [code,template] of [['FR','regional-europe'],['US','regional-north-america'],['CN','regional-china']]){
  const decision=await preview(code);assert.equal(decision.publication_id,published[template]);assert.equal(decision.fallback,false);
 }
 for(const code of ['JP','HK','MO','TW']){const decision=await preview(code);assert.equal(decision.publication_id,old);assert.equal(decision.fallback,true);}
 assert.equal((await preview(null,'unresolved')).fallback_reason,'unknown_destination');
 state=await config();const europe=state.rules.find(r=>r.rule_key==='europe');const north=state.rules.find(r=>r.rule_key==='north-america');
 await assert.rejects(()=>config({...europe,priority:north.priority}));
 await assert.rejects(()=>config({...europe,country_codes:['ZZ']}));
 await config({...north,country_codes:[...north.country_codes,'FR']});assert.equal((await preview('FR')).chain_id,north.chain_id);
 await config(north);assert.equal((await preview('FR')).chain_id,europe.chain_id);
 await config({...europe,chain_id:null});const missing=await preview('FR');assert.equal(missing.fallback_reason,'regional_publication_missing');assert.equal(missing.chain_id,state.rules.find(r=>r.is_fallback).chain_id);assert.equal(missing.matched_rule,europe.name);
 await config(europe);
 await config(null,true);
 await assert.rejects(()=>config({...state.rules.find(r=>r.is_fallback),chain_id:null}));
 const request={trip_id:'1',version_id:base,operation:'revision',input:'Regional fixture',resolution:{destination:'Kyoto',status:'resolved',country_code:'FR',source:'reviewed_alias'}};
 await assert.rejects(()=>rpc(owner,'begin',{...request,resolution:{...request.resolution,destination:'Changed'}}));
 const compatible=await rpc(owner,'begin',{...request,resolution:undefined});
 assert.equal(compatible.routing_decision.fallback_reason,'legacy_client_no_resolution');assert.equal(compatible.publication_id,old);
 await rpc(owner,'fail',{id:compatible.id,error:'End legacy compatibility fixture'});
 const started=await rpc(owner,'begin',request);assert.equal(started.publication_id,published['regional-europe']);
 assert.equal(started.routing_decision.selected_rule,europe.name);
 await config({...europe,enabled:false});
 await rpc(owner,'step',{id:started.id,step:1,text:'Fixture',model:'fixture',prompt:'Fixture',duration_ms:1});
 await db.exec('reset role');
 const saved=(await db.query('select * from studio_trip_runs where id=$1',[started.id])).rows[0];
 assert.equal(saved.publication_id,published['regional-europe']);assert.equal(saved.routing_decision.selected_rule,europe.name);
 assert.deepEqual((await db.query('select id,publication_id,outputs from studio_trip_runs where id=any($1::uuid[]) order by id',[history.map(r=>r.id)])).rows,history);
 assert.equal((await db.query('select active_version_id from studio_integration_config')).rows[0].active_version_id,old);
 await rpc(owner,'fail',{id:started.id,error:'End isolated fixture'});
 await config(null,false);
 const legacy=await rpc(owner,'begin',{trip_id:'1',version_id:base,operation:'revision',input:'Legacy fixture'});assert.equal(legacy.publication_id,old);
 await rpc(owner,'fail',{id:legacy.id,error:'End isolated fixture'});
 console.log('PASS: regional SQL permissions, independent publication, exact routing/precedence, HK/MO/TW fallback, missing assignment, unknown, valid fallback enforcement, destination race rejection, pinned run attribution and unchanged legacy records. Isolated fixtures only.');
}
