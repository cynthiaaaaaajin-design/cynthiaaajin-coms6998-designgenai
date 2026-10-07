import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, deps = {}, extra = {}) {
 const loaded = { exports: {} };
 const code = ts.transpileModule(readFileSync(path,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Response, Request, URL, console, ...extra, require: n => { assert.ok(n in deps,n); return deps[n]; } });
 return loaded.exports;
}
const itinerary = load('lib/itinerary.ts');
const versionId = '11111111-1111-4111-8111-111111111111';
const activity = { day_number:1,position:0,start_time:null,title:'Walk',description:null,location:null };
const raw = JSON.stringify({ activities:[activity] });
async function run(o={}) {
 const calls=[], logs=[], generations=[]; let counts=0;
 const client={auth:{getUser:async()=>({data:{user:o.signedOut?null:{id:'owner'}}})},from(table){
  const q={table,op:'select',filters:[]};
  const chain={select(cols,options){q.cols=cols;q.options=options;return chain;},eq(k,v){q.filters.push([k,v]);return chain;},insert(payload){q.op='insert';q.payload=payload;return chain;},update(payload){q.op='update';q.payload=payload;return chain;},maybeSingle(){return finish();},then(resolve,reject){return finish().then(resolve,reject);}};
  async function finish(){calls.push(q);
   if(q.op==='insert')return {error:o.insertError?{code:'23505'}:null};
   if(q.op==='update')return {data:o.updateError?null:{id:versionId},error:null};
   if(table==='trips')return {data:o.notOwner?null:{start_date:'2026-10-10',end_date:'2026-10-10'}};
   if(table==='itinerary_versions')return {data:o.missingVersion?null:{id:versionId,source:'ai_initial',prompt_text:o.noPrompt?null:'PRIVATE_PROMPT',response_text:o.invalid?'bad':o.wrapped?JSON.stringify({response_text:raw}):raw}};
   counts++;return {count:o.countError?null:o.healthy?1:o.raced&&counts===2?1:0,error:o.countError?{code:'42501'}:null};
  }return chain;
 }};
 const route=load('app/api/trips/[tripId]/repair/route.ts',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/itinerary':itinerary,'@/lib/gemini':{generateItinerary:async(...args)=>{generations.push(args);if(o.geminiError)throw new Error('PRIVATE_RESPONSE');return {activities:[activity],responseText:raw};}}},{console:{info:(...args)=>logs.push(args)}});
 const response=await route.POST(new Request('http://localhost/api/trips/3/repair',{method:'POST',headers:{origin:o.crossOrigin?'https://evil.test':'http://localhost'},body:JSON.stringify({versionId,user_id:'forged'})}),{params:Promise.resolve({tripId:'3'})});
 assert.ok(!JSON.stringify(logs).includes('PRIVATE_'));
 return {status:response.status,body:await response.json(),calls,generations};
}
for(const wrapped of [false,true]){const r=await run({wrapped});assert.equal(r.status,201);assert.equal(r.generations.length,0);assert.equal(r.calls.filter(q=>q.op==='update').length,0);const write=r.calls.find(q=>q.op==='insert');assert.equal(write.table,'itinerary_items');assert.equal(write.payload[0].version_id,versionId);assert.equal(write.payload[0].origin,'ai');}
const regenerated=await run({invalid:true});assert.equal(regenerated.status,201);assert.equal(regenerated.generations[0][0],'PRIVATE_PROMPT');assert.equal(regenerated.generations[0][3],false);const update=regenerated.calls.find(q=>q.op==='update');assert.deepEqual(Object.keys(update.payload),['response_text']);assert.equal(update.payload.response_text,raw);
for(const [options,status] of [[{signedOut:true},401],[{notOwner:true},403],[{missingVersion:true},404],[{healthy:true},409],[{raced:true,invalid:true},409],[{countError:true},500],[{noPrompt:true,invalid:true},500],[{geminiError:true,invalid:true},500],[{crossOrigin:true},400]]) {const r=await run(options);assert.equal(r.status,status);assert.ok(!r.calls.some(q=>q.op==='insert'||q.op==='update'));}
const collision=await run({insertError:true,invalid:true});assert.equal(collision.status,500);assert.ok(!collision.calls.some(q=>q.op==='update'));
const responseFailure=await run({updateError:true,invalid:true});assert.equal(responseFailure.status,201);
console.log('PASS: saved/wrapped response recovery, exact saved prompt fallback, same-version inserts, owner/auth checks, healthy-version protection, empty-count recheck, count/provider/insert failures, collision guard, no metadata mutation, and content-free diagnostics.');
