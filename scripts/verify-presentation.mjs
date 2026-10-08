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
 vm.runInNewContext(code, { module: loaded, exports: loaded.exports, console: {info() {}, error() {}}, URL, require: name => { assert.ok(name in base,name); return base[name]; } });
 return loaded.exports;
}
const destinations=load('lib/destinations.ts');
const initials=load('components/traveler-initials.tsx');
const scenes=load('components/trip-covers/scenes.tsx');
const covers=load('components/trip-cover-art.tsx',{'@/lib/destinations':destinations,'@/components/trip-covers/scenes':scenes});
const cards=load('components/saved-trip-card.tsx',{'@/components/traveler-initials':initials,'@/lib/destinations':destinations,'@/components/trip-cover-art':covers});
const shared={id:'3',title:'Shared weekend',destination:'Tokyo',isOwner:false,ownerName:'Cynthia Jin',start_date:null,end_date:null};
const sharedHtml=renderToStaticMarkup(React.createElement(cards.SavedTripCard,{trip:shared,index:0}));
assert.match(sharedHtml,/Shared with you/);assert.match(sharedHtml,/Owned by Cynthia Jin/);assert.match(sharedHtml,/CJ/);assert.doesNotMatch(sharedHtml,/>Owner</);
const ownHtml=renderToStaticMarkup(React.createElement(cards.SavedTripCard,{trip:{...shared,isOwner:true},index:0,viewerName:'Yuxin Jin'}));assert.match(ownHtml,/>Owner</);assert.match(ownHtml,/YJ/);
for(const trips of [[],[shared]]){
 const client={auth:{getUser:async()=>({data:{user:{id:'viewer'}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{first_name:'Yuxin',last_name:'Jin'}})})})})};
 const page=load('app/trips/page.tsx',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/supabase/config':{supabaseConfig:()=>({url:'https://example.supabase.co'})},'@/components/header':{Header:()=>null},'@/components/saved-trip-card':cards,'@/lib/travelers-server':{loadPrivateTrips:async()=>trips}});
 const html=renderToStaticMarkup(await page.default());assert.match(html,/Plan your first trip/);assert.match(html,/journal-owned/);assert.match(html,/journal-shared/);assert.match(html,/journal-feedback/);assert.doesNotMatch(html,/Complete your profile/);
 if(trips.length)assert.match(html,/Shared with you/);
}
const feedback=load('components/activity-feedback.tsx');
const props={tripId:'3',itemId:'item',title:'Walk',initialSummary:{likes:1,dislikes:0,mine:{value:1,comment:'Lovely'},group:[{userId:'viewer',name:'Yuxin',value:1,comment:'Lovely'}]}};
const html=renderToStaticMarkup(React.createElement(feedback.ActivityFeedback,props));assert.match(html,/GROUP PULSE/);assert.match(html,/YOUR TAKE/);assert.match(html,/Skip \(Dislike\)/);assert.match(html,/Traveler feedback/);
const history=renderToStaticMarkup(React.createElement(feedback.ActivityFeedback,{...props,readOnly:true}));assert.doesNotMatch(history,/<form/);assert.match(history,/Lovely/);
console.log('PASS: real component rendering for owned/shared cards, empty/shared dashboards, identity fallbacks, group/personal feedback, and read-only history. No invented totals.');
