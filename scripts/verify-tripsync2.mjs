import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const load=async p=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync(new URL(p,import.meta.url),'utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const {minor,allocate,settlement}=await load('../lib/expenses.ts');
assert.equal(minor('0.01','EUR'),1);assert.equal(minor('100','JPY'),100);assert.equal(minor('1.234','KWD'),1234);
for(const [v,c] of [['1.001','USD'],['1.2','JPY'],['-1','EUR'],['NaN','USD']])assert.throws(()=>minor(v,c));
assert.deepEqual(allocate(100,'equal',[{user_id:'c'},{user_id:'a'},{user_id:'b'}],'EUR'),[{user_id:'a',amount:34},{user_id:'b',amount:33},{user_id:'c',amount:33}]);
assert.deepEqual(allocate(101,'percentage',[{user_id:'a',value:'50'},{user_id:'b',value:'50'}],'USD'),[{user_id:'a',amount:51},{user_id:'b',amount:50}]);
assert.throws(()=>allocate(100,'custom',[{user_id:'a',value:'0.50'}],'EUR'));
const expenses=[{currency:'EUR',amount:6000,payer_id:'cynthia',allocations:[{user_id:'cynthia',amount:3000},{user_id:'amy',amount:3000}]},{currency:'EUR',amount:9000,payer_id:'amy',allocations:[{user_id:'cynthia',amount:3000},{user_id:'amy',amount:3000},{user_id:'ben',amount:3000}]},{currency:'EUR',amount:4500,payer_id:'ben',allocations:[{user_id:'cynthia',amount:2250},{user_id:'ben',amount:2250}]},{currency:'USD',amount:1001,payer_id:'cynthia',allocations:[{user_id:'cynthia',amount:501},{user_id:'ben',amount:500}]}];
const result=settlement(expenses);
assert.deepEqual(result.ledgers.EUR,{cynthia:-2250,amy:3000,ben:-750});assert.deepEqual(result.ledgers.USD,{cynthia:500,ben:-500});
assert.deepEqual(result.transfers,[{from:'ben',to:'amy',amount:750,currency:'EUR'},{from:'cynthia',to:'amy',amount:2250,currency:'EUR'},{from:'ben',to:'cynthia',amount:500,currency:'USD'}]);
for(let amount=1;amount<=300;amount++){const shares=allocate(amount,'equal',[{user_id:'a'},{user_id:'b'},{user_id:'c'}],'EUR');assert.equal(shares.reduce((s,a)=>s+a.amount,0),amount);const r=settlement([{currency:'EUR',payer_id:'a',amount,allocations:shares}]);assert.equal(r.transfers.reduce((s,t)=>s+t.amount,0),amount-shares[0].amount);}
const {parseCopilotReply}=await load('../lib/copilot.ts');assert.throws(()=>parseCopilotReply('{"intent":"write_database"}'));assert.throws(()=>parseCopilotReply(JSON.stringify({intent:'revision',reply:'x',scope:'day',day:null,instruction:'x'})));
const {parseReservation}=await load('../lib/reservations.ts');assert.throws(()=>parseReservation({kind:'flight',status:'booked',details:{}}));assert.throws(()=>parseReservation({kind:'hotel',status:'booked',details:{name:'Hotel',address:'Paris',checkin_local:'2026-11-10T15:00',checkout_local:'2026-11-09T11:00',timezone:'Europe/Paris'}}));
const {externalTravelSearch}=await load('../lib/travel-search.ts');const search=externalTravelSearch.search({kind:'hotel',destination:'Paris',start:'2026-11-10',end:'2026-11-12',guests:2});assert.equal(search.availability,'not_checked');assert.equal(new URL(search.url).hostname,'www.google.com');assert.equal('price' in search,false);
console.log('PASS TripSync 2: independent example balances, separate currencies, 300 rounding cases, exact custom/percentage validation, structured intent validation, reservation validation and truthful search fallback.');
