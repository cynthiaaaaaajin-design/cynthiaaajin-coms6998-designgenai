import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, deps = {}, globals = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(path,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, URL, Response, Request, AbortSignal, Buffer, ...globals, require: name => { assert.ok(name in deps,name);return deps[name]; } });
  return loaded.exports;
}
async function check({signedIn=true,rows=[{id:1}],dbError=null,origin='https://trip.test'}={}) {
 const filters=[];let deleted=false;
 const client={auth:{getUser:async()=>({data:{user:signedIn?{id:'owner'}:null}})},from(table){assert.equal(table,'trips');const chain={delete(){deleted=true;return chain},eq(key,value){filters.push([key,value]);return chain},select:async()=>({data:rows,error:dbError})};return chain;}};
 const route=load('app/api/trips/[tripId]/route.ts',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/itinerary':load('lib/itinerary.ts')});
 const response=await route.DELETE(new Request('https://trip.test/api/trips/1',{method:'DELETE',headers:{origin}}),{params:Promise.resolve({tripId:'1'})});
 return {status:response.status,deleted,filters};
}
const ok=await check();assert.equal(ok.status,200);assert.ok(ok.filters.some(([key,value])=>key==='user_id'&&value==='owner'));assert.ok(ok.filters.some(([key,value])=>key==='id'&&value==='1'));
assert.equal((await check({rows:[]})).status,403);
assert.equal((await check({dbError:{code:'23503'}})).status,409);
assert.equal((await check({signedIn:false})).deleted,false);
assert.equal((await check({origin:'https://evil.test'})).deleted,false);
console.log('PASS: owner-constrained atomic delete, zero-row/RLS denial, foreign-key failure, signed-out and cross-origin rejection. Database mocked.');
