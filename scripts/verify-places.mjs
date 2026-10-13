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
const key='test-server-secret';
const example={id:'ChIJ123',displayName:{text:'Jerónimos Monastery'},formattedAddress:'Belém, Lisbon, Portugal',rating:4.6,userRatingCount:2300,priceLevel:'PRICE_LEVEL_MODERATE',googleMapsLinks:{placeUri:'https://www.google.com/maps/place/example',directionsUri:'https://www.google.com/maps/dir/example',reviewsUri:'https://www.google.com/maps/reviews/example'}};
async function resolve({ places=[example], enabled=true, fail=false, photoFail=false }={}) {
  const calls=[];
  const api=load('lib/places.ts',{'server-only':{}},{process:{env:{GOOGLE_PLACES_ENABLED:String(enabled),GOOGLE_PLACES_API_KEY:key}},fetch:async(url,options)=>{
    calls.push({url:String(url),options});
    if(fail) throw new Error('Timeout with '+key);
    if(String(url).includes('/media')) return new Response(JSON.stringify({photoUri:'https://lh3.googleusercontent.com/photo'}));
    if(String(url).includes('googleusercontent')) return photoFail ? new Response('',{status:404}) : new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});
    return new Response(JSON.stringify({places}));
  }});
  return {result:await api.resolvePlace('Visit Jerónimos Monastery','Belém','Lisbon, Portugal'),calls,api};
}
const success=await resolve();assert.equal(success.result.rating,4.6);assert.equal(success.result.price,'$$');assert.equal(success.calls.length,1);
assert.equal(success.calls[0].options.cache,'no-store');assert.ok(!success.api.PLACES_FIELDS.includes('places.reviews,'));assert.ok(!success.api.PLACES_FIELDS.includes('*'));
assert.match(JSON.parse(success.calls[0].options.body).textQuery,/Visit Jerónimos Monastery, Belém, Lisbon/);
assert.equal(success.api.safeGoogleLink('javascript:alert(1)'),undefined);
assert.equal(success.api.safeGoogleLink('https://google.com.evil.test'),undefined);
assert.equal(success.api.plausiblePlace('Lisbon Cafe','Free time','Lisbon','Lisbon, Portugal'),false);
assert.equal((await resolve({places:[]})).result,null);
assert.equal((await resolve({places:[{...example,displayName:{text:'Unrelated museum'}}]})).result,null);
assert.equal((await resolve({fail:true})).result,null);
assert.equal((await resolve({enabled:false})).calls.length,0);
const photo=await resolve({places:[{...example,photos:[{name:'places/ChIJ123/photos/photo123',authorAttributions:[{displayName:'Photographer',uri:'https://maps.google.com/maps/contrib/123'}],googleMapsUri:'https://www.google.com/maps/photo'}]}]});
assert.match(photo.result.photo.src,/^data:image\/jpeg;base64,/);assert.equal(photo.result.photo.authors[0].name,'Photographer');assert.ok(!JSON.stringify(photo.result).includes(key));assert.equal(photo.calls[2].options.headers,undefined);
assert.equal((await resolve({places:[{...example,photos:[{name:'places/ChIJ123/photos/photo123'}]}],photoFail:true})).result.photo,undefined);
const itinerary=load('lib/itinerary.ts');
async function routeCase({signedOut=false,access=true,version=true,enabled=true}={}){
 let resolved=0;
 const client={auth:{getUser:async()=>({data:{user:signedOut?null:{id:'member'}}})},from(table){const chain={select(){return chain},eq(){return chain},maybeSingle:async()=>({data:table==='itinerary_items'?{title:'Visit',location:'Place',version_id:'v1'}:version?{id:'v1'}:null})};return chain}};
 const route=load('app/api/trips/[tripId]/places/route.ts',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/feedback-server':{accessibleTrip:async()=>access?{destination:'Lisbon'}:null},'@/lib/itinerary':itinerary,'@/lib/places':{placesEnabled:()=>enabled,resolvePlace:async()=>{resolved++;return example}}});
 const response=await route.GET(new Request('https://trips.test/api/trips/1/places?item=12345678-1234-1234-1234-123456789abc'),{params:Promise.resolve({tripId:'1'})});
 assert.match(response.headers.get('cache-control'),/no-store/);return {status:response.status,resolved};
}
for(const options of [{signedOut:true},{access:false},{version:false},{enabled:false}])assert.equal((await routeCase(options)).resolved,0);
assert.equal((await routeCase()).resolved,1);
console.log('PASS: optional/no-match/timeout/malformed links, selected fields, photo attribution/failure, key isolation, authenticated trip/item scope, and no-store Places responses. Google calls mocked.');
