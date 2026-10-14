// Behavior and API tests; Supabase/Gemini adapters mocked. Real SQL is tested separately.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function load(path,deps={}) {
 const loaded={exports:{}};
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{module:loaded,exports:loaded.exports,Request,Response,URL,console,require:n=>{assert.ok(n in deps,`Unexpected dependency: ${n}`);return deps[n];}});return loaded.exports;
}
const collaboration=load('../lib/collaboration.ts');
const editing=load('../lib/itinerary-editing.ts',{'./collaboration':collaboration});
const itinerary=load('../lib/itinerary.ts');
const feedback=load('../lib/feedback.ts');
const prompts=load('../lib/proposal-prompt.ts',{'./feedback':feedback});
const owner='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',base='33333333-3333-4333-8333-333333333333',item='44444444-4444-4444-8444-444444444444',proposalId='55555555-5555-4555-8555-555555555555';
const items=[{id:item,day_number:1,position:0,start_time:'09:00:00',title:'Museum',description:'Art',location:'Paris'}];
const draft=editing.asDraft(items);
assert.equal(draft[0].start_time,'09:00');
for(const bad of [[],[{...draft[0],title:''}],[{...draft[0],start_time:'25:00'}],[{...draft[0],position:1}],[{...draft[0],day_number:2}], [draft[0],{...draft[0],position:1}], [{...draft[0],source_item_id:'bad'}]])assert.throws(()=>editing.validateDraft(bad,1));
const moved=editing.orderDraft([{...draft[0],day_number:2},{...draft[0],source_item_id:null,day_number:1,title:'Park'}]);
assert.equal(moved[0].title,'Park');assert.equal(moved[1].position,0);
const changes=editing.changeSummary(draft,[{...draft[0],start_time:'13:00'},{...draft[0],source_item_id:null,position:1,title:'Park'}]);
assert.equal(changes.length,2);assert.ok(changes[0].text.includes('09:00 → 13:00'));
const aiBody={activities:[{...draft[0],source_item_id:null,title:'Park'}],explanation:'Less tiring',uncertainties:['Hours unverified']};
assert.equal(editing.parseProposal(JSON.stringify(aiBody),1,'activity',1).activities[0].title,'Park');
for(const bad of [{...aiBody,activities:[draft[0]]},{...aiBody,activities:[{...aiBody.activities[0],day_number:2}]},{...aiBody,explanation:''},{...aiBody,uncertainties:[{}]}])assert.throws(()=>editing.parseProposal(JSON.stringify(bad),2,'activity',1));
assert.throws(()=>editing.parseProposal(JSON.stringify(aiBody),2,'trip',null));
const snapshot={participants:[owner,member],preferences:[{user_id:member,budget_amount:100,budget_currency:'EUR',budget_scope:'per_person_day',travel_pace:'relaxed',hard_constraints:['No stairs'],interests:['Art'],must_visit_places:[],additional_notes:null,budget_notes:null}]};
const state={user:owner,outsider:false,current:base,rpcError:null,aiError:false,response:JSON.stringify(aiBody),calls:[],generatedPrompt:''};
const client={
 auth:{getUser:async()=>({data:{user:state.user?{id:state.user}:null}})},
 rpc:async(name,args)=>{state.calls.push({name,args});return {data:state.rpcError?null:proposalId,error:state.rpcError?{code:state.rpcError}:null};},
};
const common=load('../lib/collaboration-route.ts',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/feedback-server':{accessibleTrip:async()=>state.outsider?null:{user_id:owner,destination:'Paris',start_date:'2026-10-10',end_date:'2026-10-10'}},'@/lib/itinerary':itinerary});
const deps={'@/lib/collaboration-route':common,'@/lib/collaboration':collaboration,'@/lib/itinerary':itinerary,'@/lib/itinerary-editing':editing};
const manual=load('../app/api/trips/[tripId]/edit/route.ts',deps);
const proposal=load('../app/api/trips/[tripId]/proposals/route.ts',{...deps,
 '@/lib/itinerary-editing-server':{currentEditingContext:async()=>({version:{id:state.current},items}),preferenceSnapshot:async()=>snapshot},
 '@/lib/feedback-server':{loadVoteRows:async()=>[{id:'1',item_id:item,user_id:member,value:-1,comment:'Too tiring'}]},
 '@/lib/collaboration-server':{loadChangeRequests:async()=>[{item_id:item,created_by:member,status:'pending',request_type:'replacement',suggested_replacement:'Park',comment:'Flat paths'}]},
 '@/lib/proposal-prompt':prompts,'@/lib/gemini':{generateItineraryProposal:async prompt=>{state.generatedPrompt=prompt;if(state.aiError)throw new Error('Offline');return state.response;}},
});
async function call(route,body,method='POST',headers={}) {
 return route[method](new Request('http://localhost/api/trips/1/action',{method,headers,body:JSON.stringify(body)}),{params:Promise.resolve({tripId:'1'})});
}
const manualBody={base_version_id:base,activities:draft};
for(const user of [owner,member]) {state.user=user;assert.equal((await call(manual,manualBody)).status,201);assert.equal(state.calls.at(-1).name,'save_manual_itinerary');}
state.rpcError='40001';const stale=await call(manual,manualBody);assert.equal(stale.status,409);assert.equal((await stale.json()).error,editing.staleDraftMessage);state.rpcError=null;
assert.equal((await call(manual,{...manualBody,activities:[]})).status,400);
assert.equal((await call(manual,manualBody,'POST',{origin:'https://other.example'})).status,403);
const requestBody={base_version_id:base,scope:'activity',day:1,item_id:item,instruction:'Choose a cheaper alternative'};
for(const who of [null,'outsider']) {
 state.user=who;state.outsider=who==='outsider';
 for(const route of [manual,proposal])assert.equal((await call(route,route===manual?manualBody:requestBody)).status,who?404:401);
}
state.outsider=false;state.user=member;
assert.equal((await call(proposal,{...requestBody,scope:'trip'})).status,403);
assert.equal((await call(proposal,{proposal_id:proposalId},'PATCH')).status,403);
assert.equal((await call(proposal,requestBody)).status,201);
assert.equal(state.calls.at(-1).name,'save_itinerary_proposal');assert.equal(state.calls.at(-1).args.p_response,state.response);
for(const text of ['No stairs','Too tiring','Flat paths','Choose a cheaper alternative','untrusted traveler data','unselected activities remain exactly unchanged'])assert.ok(state.generatedPrompt.includes(text));
state.current=proposalId;assert.equal((await call(proposal,requestBody)).status,409);state.current=base;
const beforeCalls=state.calls.length;state.aiError=true;assert.equal((await call(proposal,requestBody)).status,502);assert.equal(state.calls.length,beforeCalls);state.aiError=false;
state.response='invalid';assert.equal((await call(proposal,requestBody)).status,502);state.response=JSON.stringify(aiBody);
assert.equal((await call(proposal,{...requestBody,item_id:owner})).status,400);
state.user=owner;assert.equal((await call(proposal,{proposal_id:proposalId},'PATCH')).status,201);assert.equal(state.calls.at(-1).name,'apply_itinerary_proposal');
state.rpcError='40001';
let conflict=await call(proposal,{proposal_id:proposalId},'PATCH');assert.equal(conflict.status,409);assert.equal((await conflict.json()).error,editing.staleDraftMessage);
conflict=await call(proposal,requestBody);assert.equal(conflict.status,409);assert.equal((await conflict.json()).error,editing.staleDraftMessage);
state.rpcError='P3001';conflict=await call(proposal,{proposal_id:proposalId},'PATCH');assert.equal(conflict.status,409);assert.equal((await conflict.json()).error,editing.preferenceConflictMessage);
state.rpcError=null;
// Actual component rendering covers privilege-dependent controls and before/after preview.
const ui=load('../components/itinerary-workspace.tsx',{react:React,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({refresh(){},push(){}})},'@/lib/itinerary-editing':editing,'./planning-status':{PlanningStatus:()=>null}});
const props={tripId:'1',versionId:base,items,days:1,isOwner:false,isCurrent:true,proposals:[{id:proposalId,base_version_id:base,created_by:member,scope:'activity',target_day:1,target_item_id:item,instruction:'Cheaper',response_text:JSON.stringify(aiBody),created_at:'2026-10-14',applied_version_id:null}],people:[{user_id:member,name:'Member'}],changed:true,loadError:false,children:React.createElement('p',null,'Existing timeline')};
const memberHtml=renderToStaticMarkup(React.createElement(ui.ItineraryWorkspace,props));
assert.match(memberHtml,/Edit itinerary/);assert.match(memberHtml,/Before/);assert.match(memberHtml,/After/);assert.match(memberHtml,/Existing timeline/);assert.doesNotMatch(memberHtml,/>Apply changes</);assert.doesNotMatch(memberHtml,/Regenerate with updated preferences/);
const ownerHtml=renderToStaticMarkup(React.createElement(ui.ItineraryWorkspace,{...props,isOwner:true}));assert.match(ownerHtml,/>Apply changes</);assert.match(ownerHtml,/Travel preferences have changed/);assert.match(ownerHtml,/Regenerate with updated preferences/);
const historic=renderToStaticMarkup(React.createElement(ui.ItineraryWorkspace,{...props,isOwner:true,isCurrent:false}));assert.doesNotMatch(historic,/>Edit itinerary<|>Apply changes</);assert.match(historic,/Historical version/);
console.log('PASS Phase 3: draft ordering/validation/diffs, AI scope/schema checks, owner/member routes, stale saves/proposals, untrusted preference+feedback context, no publication on generation failure, and real role-specific Before/After component rendering.');
