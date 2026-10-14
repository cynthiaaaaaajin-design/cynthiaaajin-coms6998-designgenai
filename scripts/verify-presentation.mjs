// Render real presentation components with fixture data; no Supabase/network writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
const link = { default: ({ children, ...props }) => React.createElement('a', props, children) };
const nav = { useRouter: () => ({ refresh() {}, push() {} }), redirect() { throw new Error('Redirect'); } };
function load(path, deps = {}) {
 const loaded = { exports: {} };
 const base = { react: React, 'react/jsx-runtime': jsx, 'next/link': link, 'next/navigation': nav, ...deps };
 const code = ts.transpileModule(readFileSync(path,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
 vm.runInNewContext(code, { module: loaded, exports: loaded.exports, process: { env: {} }, console: {info() {}, error() {}}, URL, require: name => { assert.ok(name in base,name); return base[name]; } });
 return loaded.exports;
}
const destinations=load('lib/destinations.ts');
const initials=load('components/traveler-initials.tsx');
const scenes=load('components/trip-covers/scenes.tsx');
const covers=load('components/trip-cover-art.tsx',{'@/lib/destinations':destinations,'@/components/trip-covers/scenes':scenes});
const cards=load('components/saved-trip-card.tsx',{'@/components/destination-cover-photo':{DestinationCoverPhoto:({fallback})=>fallback},'@/components/traveler-initials':initials,'@/lib/destinations':destinations,'@/components/trip-cover-art':covers});
const shared={id:'3',title:'Shared weekend',destination:'Tokyo',isOwner:false,ownerName:'Cynthia Jin',start_date:null,end_date:null};
const sharedHtml=renderToStaticMarkup(React.createElement(cards.SavedTripCard,{trip:shared,index:0}));
assert.match(sharedHtml,/role-shared">Shared</);assert.match(sharedHtml,/Owned by Cynthia Jin/);assert.match(sharedHtml,/CJ/);assert.doesNotMatch(sharedHtml,/>Owner</);
const ownHtml=renderToStaticMarkup(React.createElement(cards.SavedTripCard,{trip:{...shared,isOwner:true},index:0,viewerName:'Yuxin Jin'}));assert.match(ownHtml,/>Owner</);assert.match(ownHtml,/YJ/);
for(const trips of [[],[shared]]){
 const client={auth:{getUser:async()=>({data:{user:{id:'viewer'}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{first_name:'Yuxin',last_name:'Jin'}})})})})};
 const page=load('app/trips/page.tsx',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/supabase/config':{supabaseConfig:()=>({url:'https://example.supabase.co'})},'@/components/header':{Header:()=>null},'@/components/saved-trip-card':cards,'@/lib/travelers-server':{loadPrivateTrips:async()=>trips}});
 const html=renderToStaticMarkup(await page.default());assert.match(html,/Trip collection/);assert.match(html,/journal-owned/);if(!trips.length)assert.match(html,/Plan your first trip/);assert.doesNotMatch(html,/Complete your profile/);
 if(trips.length)assert.match(html,/role-shared">Shared</);
}
const feedback=load('components/activity-feedback.tsx');
const props={tripId:'3',itemId:'item',title:'Walk',initialSummary:{likes:1,dislikes:0,mine:{value:1,comment:'Lovely'},group:[{userId:'viewer',name:'Yuxin',value:1,comment:'Lovely'}]}};
const html=renderToStaticMarkup(React.createElement(feedback.ActivityFeedback,props));assert.match(html,/GROUP FEEDBACK/);assert.match(html,/YOUR FEEDBACK/);assert.match(html,/>Dislike<\/button>/);assert.doesNotMatch(html,/Skip/);assert.match(html,/Traveler feedback/);
const history=renderToStaticMarkup(React.createElement(feedback.ActivityFeedback,{...props,readOnly:true}));assert.doesNotMatch(history,/<form/);assert.match(history,/Lovely/);
console.log('PASS: real component rendering for owned/shared cards, empty/shared dashboards, identity fallbacks, group/personal feedback, and read-only history. No invented totals.');
const collaboration = load('lib/collaboration.ts');
const preferencesUi = load('components/travel-preferences.tsx');
const preferenceProps = { tripId:'3', userId:'viewer', people:[{user_id:'viewer',name:'Yuxin'},{user_id:'owner',name:'Cynthia'}], preferences:[], error:false };
const emptyPreferences=renderToStaticMarkup(React.createElement(preferencesUi.TravelPreferences,preferenceProps));
assert.match(emptyPreferences,/0 of 2 travelers/); assert.match(emptyPreferences,/Add my preferences/); assert.match(emptyPreferences,/role="progressbar"/);
const sharedPreferences=renderToStaticMarkup(React.createElement(preferencesUi.TravelPreferences,{...preferenceProps,preferences:[{user_id:'viewer',budget_amount:200,budget_currency:'EUR',budget_scope:'per_person_day',budget_notes:null,travel_pace:'relaxed',must_visit_places:['Museum'],interests:['Art'],hard_constraints:['No stairs'],additional_notes:null}]}));
assert.match(sharedPreferences,/Edit my preferences/); assert.match(sharedPreferences,/EUR 200 per person per day/);assert.match(sharedPreferences,/Hard constraints/);assert.match(sharedPreferences,/No stairs/);
const suggestionUi=load('components/activity-suggestion.tsx',{'@/lib/collaboration':collaboration});
const suggestionHtml=renderToStaticMarkup(React.createElement(suggestionUi.ActivitySuggestion,{tripId:'3',itemId:'item',versionId:'version',title:'Museum'}));
assert.match(suggestionHtml,/<details[^>]*><summary>Suggest a change/); assert.doesNotMatch(suggestionHtml,/<details[^>]* open/);assert.match(suggestionHtml,/Too expensive/);assert.match(suggestionHtml,/Suggest replacement/);
const center=load('components/suggestions-center.tsx',{'@/lib/collaboration':collaboration});
const centerProps={tripId:'3',requests:[{id:'request',item_id:'item',version_id:'version',created_by:'viewer',request_type:'too_expensive',comment:'Cheaper museum?',status:'pending',suggested_replacement:'Park'}],people:[{user_id:'viewer',name:'Yuxin'}],items:[{id:'item',title:'Museum',day_number:2}],isOwner:true,isCurrent:true,versionNumber:1,error:false};
const ownerCenter=renderToStaticMarkup(React.createElement(center.SuggestionsCenter,centerProps));
assert.match(ownerCenter,/1 pending/); assert.match(ownerCenter,/Day 2/);assert.match(ownerCenter,/Mark resolved/);assert.match(ownerCenter,/Decline suggestion/);assert.match(ownerCenter,/Yuxin/);
const memberCenter=renderToStaticMarkup(React.createElement(center.SuggestionsCenter,{...centerProps,isOwner:false,isCurrent:false}));
assert.doesNotMatch(memberCenter,/Mark resolved|Decline suggestion/);assert.match(memberCenter,/Historical itinerary/);assert.match(memberCenter,/Your submitted suggestions/);
const generate=load('components/generate-itinerary-form.tsx',{'@/components/planning-status':{PlanningStatus:()=>null}});
const incomplete=renderToStaticMarkup(React.createElement(generate.GenerateItineraryForm,{tripId:'3',submitted:1,total:2}));
assert.match(incomplete,/1 of 2 travelers/);assert.match(incomplete,/Generate anyway/);assert.match(incomplete,/wait for everyone/);
console.log('PASS: real collaboration component rendering, participant progress, budget scope, hard constraints, compact suggestion disclosure, owner/member actions, historical labels, and Generate anyway.');
