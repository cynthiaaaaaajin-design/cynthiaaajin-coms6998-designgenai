import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
function load(path,deps={},globals={}) {
 const loaded={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:loaded,exports:loaded.exports,URL,Request,Response,console,Date,...globals,require:name=>{assert.ok(name in deps,name);return deps[name];}});
 return loaded.exports;
}
const community=load('lib/community.ts');const createTrip=load('lib/create-trip.ts');const itinerary=load('lib/itinerary.ts');
const post='44444444-4444-4444-8444-444444444444';let calls=[];let mode='success';
const client={auth:{getUser:async()=>({data:{user:mode==='anonymous'?null:{id:'requesting-user'}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return mode==='unavailable'?{error:{code:'22023',message:'This publication is no longer available'}}:{data:'9007199254740993',error:null};}};
const route=load('app/api/community/[postId]/import/route.ts',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/community':community,'@/lib/create-trip':createTrip,'@/lib/itinerary':itinerary});
async function request(body,headers={},id=post){return route.POST(new Request(`https://trips.example/api/community/${id}/import`,{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)}),{params:Promise.resolve({postId:id})});}
assert.equal((await request({start_date:'2026-11-01'},{origin:'https://evil.example'})).status,403);
assert.equal((await request({start_date:'2026-11-01'},{'sec-fetch-site':'cross-site'})).status,403);
assert.equal((await request({start_date:'2026-11-01'},{},'bad-id')).status,400);
mode='anonymous';assert.equal((await request({start_date:'2026-11-01'})).status,401);mode='success';
for(const body of ['bad json',{start_date:'2026-02-30'},null,{start_date:''}])assert.equal((await request(body)).status,400);
assert.equal(calls.length,0);
const success=await request({start_date:'2026-11-01',user_id:'forged-owner',activities:[{title:'Injected'}]});assert.equal(success.status,201);assert.equal((await success.json()).tripId,'9007199254740993');
assert.equal(calls[0].name,'import_community_trip');assert.equal(JSON.stringify(calls[0].args),JSON.stringify({p_post_id:post,p_start_date:'2026-11-01'}));
mode='unavailable';assert.equal((await request({start_date:'2026-11-01'})).status,400);
const destinations=load('lib/destinations.ts');let photoCalls=[];let publicationVisible=true;
const query={select:()=>query,eq:(column,value)=>{if(column==='status')assert.equal(value,'published');return query;},maybeSingle:async()=>({data:publicationVisible?{destination:'Madrid; Seville; Rome'}:null,error:null})};
const photoRoute=load('app/api/community/[postId]/photo/route.ts',{'@/lib/supabase/server':{createClient:async()=>({from:table=>{assert.equal(table,'community_posts');return query;}})},'@/lib/community':community,'@/lib/destinations':destinations,'@/lib/google-places':{destinationPhoto:async(destination,index)=>{photoCalls.push({destination,index});return {src:'photo',count:5,authors:[]};}}});
async function photo(index){return photoRoute.GET(new Request(`https://trips.example/photo?index=${index}`),{params:Promise.resolve({postId:post})});}
assert.equal((await photo(7)).status,400);assert.equal(photoCalls.length,0);
const result=await photo(1);assert.equal(result.status,200);assert.equal((await result.json()).count,3);assert.equal(photoCalls[0].destination,'Seville');assert.equal(photoCalls[0].index,0);
assert.equal((await photo(3)).status,400);publicationVisible=false;assert.equal((await photo(0)).status,404);assert.equal(photoCalls.length,1);
console.log('PASS Community API: authenticated session ownership, exact bigint IDs, origin/date/body validation, server-trusted snapshot, private-publication isolation and multi-destination photo routing.');

const cards=load('components/saved-trip-card.tsx',{
 'react/jsx-runtime':jsx,'next/link':{default:({children,...props})=>createElement('a',props,children)},
 '@/components/arrow-icon':{ArrowIcon:()=>null},'@/components/destination-cover-photo':{DestinationCoverPhoto:()=>null},
 '@/components/traveler-initials':{TravelerInitials:()=>null},'@/components/trip-cover-art':{TripCoverArt:()=>null},'@/lib/destinations':destinations,
},{process:{env:{}},Intl});
const imported={id:'9007199254740993',isOwner:true,ownerName:'Current viewer',title:'My private copy',destination:'Madrid',start_date:'2026-12-15',end_date:'2026-12-16',communityAuthor:'Cynthia',communityAdopted:false};
const sharedCard=renderToStaticMarkup(createElement(cards.SavedTripCard,{trip:imported,index:0}));
assert.match(sharedCard,/Shared by Cynthia/);assert.match(sharedCard,/Your independent copy/);assert.doesNotMatch(sharedCard,/Owned by another/);
const adoptedCard=renderToStaticMarkup(createElement(cards.SavedTripCard,{trip:{...imported,communityAdopted:true},index:0}));
assert.match(adoptedCard,/>Owned</);assert.match(adoptedCard,/Inspired by Cynthia/);
console.log('PASS Community cards: imported owner permissions retain Shared by attribution, then show Owned while preserving the original author.');
