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
const destinations=load('lib/destinations.ts');
for (const destination of ['Puerto Rico','Lisbon, Portugal','Tokyo, Japan','Miami, Florida, USA','Unknown Atlantis']) {
  const calls=[];
  const known=!destination.startsWith('Unknown');
  const place={id:'ChIJdemo',displayName:{text:destination.split(',')[0]},photos:Array.from({length:7},(_,i)=>({name:`places/ChIJdemo/photos/photo${i}`,authorAttributions:[{displayName:'Photo author',uri:'https://maps.google.com/contrib/1'}]}))};
  const api=load('lib/google-places.ts',{'server-only':{},'./destinations':destinations},{process:{env:{GOOGLE_MAPS_API_KEY:'private-secret'}},fetch:async(url,options)=>{
    calls.push({url:String(url),options}); assert.equal(options.cache,'no-store');
    if(String(url).includes('googleusercontent.com')) { assert.equal(options.headers,undefined);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}}); }
    if(String(url).includes('/media?')) return Response.json({photoUri:'https://lh3.googleusercontent.com/example'});
    if(String(url).endsWith('searchText')) return Response.json({places:known?[place]:[]});
    return Response.json(place);
  }});
  const first=await api.destinationPhoto(destination,0);
  if(!known){assert.equal(first,null);continue;}
  assert.equal(first.count,5);assert.equal(first.authors[0].name,'Photo author');assert.ok(!JSON.stringify(first).includes('private-secret'));
  assert.equal(calls[0].options.headers['X-Goog-FieldMask'],'places.id,places.displayName,places.photos');
  assert.ok(await api.destinationPhoto(destination,1));assert.equal(calls.filter(call=>call.url.endsWith('searchText')).length,1);
  assert.ok(calls.some(call=>call.options.headers?.['X-Goog-FieldMask']==='id,displayName,photos'));
  assert.equal(await api.destinationPhoto(destination,5),null);
}
for(const mode of ['missing','quota','throw','noPhotos','unsafeMedia']) {
 const api=load('lib/google-places.ts',{'server-only':{},'./destinations':destinations},{process:{env:{GOOGLE_MAPS_API_KEY:mode==='missing'?undefined:'private-secret'}},fetch:async(url)=>{
   if(mode==='throw') throw Error('private-secret');
   if(mode==='quota') return new Response('',{status:429});
   if(String(url).includes('/media?')) return Response.json({photoUri:'https://untrusted.example/photo'});
   return Response.json({places:[{id:'abc',displayName:{text:'Lisbon'},photos:mode==='noPhotos'?[]:[{name:'places/abc/photos/123'}]}]});
 }});
 assert.equal(await api.destinationPhoto('Lisbon, Portugal',0),null);
}
console.log('PASS: four destinations, unknown fallback, five-photo cap, place-ID reuse/fresh metadata, attribution, secret isolation, quota, no photos, missing key and unsafe media. Google responses mocked.');
