import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
const code=ts.transpileModule(readFileSync('components/landing-video.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render({eligible=true,saveData=false,effectiveType='4g',server=false,enabled=true}={}){
 const loaded={exports:{}};
 const deps={react:{...React,useSyncExternalStore:(_,snapshot,serverSnapshot)=>server?serverSnapshot():snapshot()},'react/jsx-runtime':jsx};
 vm.runInNewContext(code,{module:loaded,exports:loaded.exports,require:name=>deps[name],window:{matchMedia:query=>{assert.match(query,/min-width: 900px/);assert.match(query,/prefers-reduced-motion: no-preference/);return {matches:eligible}}},navigator:{connection:{saveData,effectiveType}}});
 return renderToStaticMarkup(React.createElement(loaded.exports.LandingVideo,{enabled}));
}
assert.match(render(),/<video/);
for(const options of [{eligible:false},{saveData:true},{effectiveType:'3g'},{server:true},{enabled:false}]){const html=render(options);assert.doesNotMatch(html,/<video/);assert.match(html,/travel-poster.webp/)}
for(const attribute of ['muted','autoPlay','loop','playsInline','poster=','preload="none"'])assert.ok(render().toLowerCase().includes(attribute.toLowerCase()));
assert.ok(statSync('public/media/travel-loop.mp4').size < 100000);
assert.ok(statSync('public/media/travel-poster.webp').size < 20000);
console.log('PASS: desktop video, mobile/reduced-motion eligibility, data-saver/slow-network/server fallbacks, inline muted autoplay attributes, and lightweight local assets.');
