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
const versionId = '12345678-1234-1234-1234-123456789abc';
async function check({user=true, access=true, version=true, enabled=true, matched=true, mapOK=true, key=true, day='1'}={}) {
  let resolved=0, requested=0;
  const filters=[];
  const client={auth:{getUser:async()=>({data:{user:user?{id:'member'}:null}})},from(table){
    const chain={select(){return chain},eq(field,value){filters.push([table,field,value]);return chain},maybeSingle:async()=>({data:version?{id:versionId}:null}),order:async()=>({data:[{id:'item',title:'Museum',location:'Lisbon'}]})};return chain;
  }};
  const route=load('app/api/trips/[tripId]/day-map/route.ts', {
    '@/lib/day-map-layout':load('lib/day-map-layout.ts'),
    '@/lib/supabase/server':{createClient:async()=>client},
    '@/lib/feedback-server':{accessibleTrip:async()=>access?{destination:'Lisbon'}:null},
    '@/lib/itinerary':load('lib/itinerary.ts'),
    '@/lib/places':{placesEnabled:()=>enabled,resolvePlace:async(...args)=>{resolved++;assert.equal(args[3],true);return matched?{id:'place',name:'Museum',coordinates:{lat:38.7,lng:-9.1}}:null;}},
  },{process:{env:{GOOGLE_MAPS_STATIC_API_KEY:key?'server-secret':undefined}},fetch:async(url,options)=>{
    requested++;assert.equal(url.hostname,'maps.googleapis.com');assert.equal(options.cache,'no-store');assert.ok(url.searchParams.get('center'));assert.ok(url.searchParams.get('zoom'));assert.equal(url.searchParams.has('path'),false);
    return new Response(mapOK?new Uint8Array([137,80,78,71]):'denied',{status:mapOK?200:403,headers:{'content-type':mapOK?'image/png':'text/plain'}});
  }});
  const response=await route.GET(new Request(`https://trip.test/api/trips/1/day-map?version=${versionId}&day=${day}`),{params:Promise.resolve({tripId:'1'})});
  const data=await response.json();assert.ok(!JSON.stringify(data).includes('server-secret'));assert.equal(response.headers.get('cache-control'),'private, no-store');
  return {data,status:response.status,resolved,requested,filters};
}
const good=await check();assert.match(good.data.image,/^data:image\/png;base64,/);assert.equal(good.resolved,1);
assert.ok(good.filters.some(([table,field,value])=>table==='itinerary_versions'&&field==='trip_id'&&value==='1'));
assert.ok(good.filters.some(([table,field,value])=>table==='itinerary_items'&&field==='day_number'&&value===1));
for(const [options,status] of [[{user:false},401],[{access:false},404],[{version:false},404],[{day:'31'},400]]){const result=await check(options);assert.equal(result.status,status);assert.equal(result.resolved,0);assert.equal(result.requested,0);}
for(const options of [{enabled:false},{matched:false},{key:false},{mapOK:false}]){const result=await check(options);assert.equal(result.data.image,null);assert.equal(result.status,200);}
console.log('PASS: day/version scope, unauthorized access, resolved markers, no match, disabled Places, absent Maps key, map failure, server key isolation. Google calls mocked.');
