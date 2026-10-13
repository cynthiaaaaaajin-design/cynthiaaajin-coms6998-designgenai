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
const feedback=load('lib/feedback.ts');
const {calculateConsensus}=load('lib/consensus.ts');
const rows=[{id:'1',item_id:'a',user_id:'owner',value:-1},{id:'2',item_id:'a',user_id:'owner',value:1},{id:'3',item_id:'a',user_id:'member',value:-1},{id:'4',item_id:'b',user_id:'removed',value:1}];
const result=calculateConsensus(['a','b'],feedback.summarizeVotes(rows,'owner'),['owner','member','member']);
assert.equal(result.responses,2);assert.equal(result.expected,4);assert.equal(result.percentage,50);assert.equal(result.reviewed,1);assert.equal(result.awaiting,1);assert.equal(result.participating,2);assert.equal(result.positive,1);assert.equal(result.negative,1);assert.equal(result.mixed,1);
assert.equal(calculateConsensus([],{},[]).percentage,0);
const {dayMapLayout,markerCategory}=load('lib/day-map-layout.ts');
for(const coords of [[{lat:38.7,lng:-9.1}],[{lat:18.46,lng:-66.12},{lat:18.47,lng:-66.11}],[{lat:0,lng:179.9},{lat:0,lng:-179.9}]]){
 const layout=dayMapLayout(coords.map((point,i)=>({...point,itemId:String(i)})));
 assert.ok(layout.zoom>=0&&layout.zoom<=16);
 for(const marker of layout.markers){assert.ok(marker.x>5&&marker.x<95);assert.ok(marker.y>5&&marker.y<95);}
}
assert.equal(dayMapLayout([{itemId:'bad',lat:NaN,lng:10}]),null);
assert.equal(markerCategory('restaurant'),'food');assert.equal(markerCategory('hotel'),'hotel');assert.equal(markerCategory('museum'),'attraction');
console.log('PASS: latest vote deduplication, removed-member exclusion, explicit denominators, mixed feedback, empty consensus, map bounds/dateline/invalid coordinates and categories.');
