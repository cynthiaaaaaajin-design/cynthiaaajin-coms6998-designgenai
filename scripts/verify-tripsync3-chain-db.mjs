import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export async function verifyGroupChain({db,as,rpc,owner,secret}){
 await db.exec('reset role');
 for(const file of ['tripsync2-reservations.sql','tripsync2-reservation-concurrency.sql','tripsync3-preferences.sql','tripsync3-publication-context.sql','tripsync3-decisions.sql'])await db.exec(readFileSync(new URL('../sql/'+file,import.meta.url),'utf8'));
 const base=(await as(owner,'select v.id from itinerary_versions v where trip_id=1 and exists(select 1 from itinerary_items where version_id=v.id) order by version_number desc limit 1')).rows[0].id;
 const decision=randomUUID(),options=[{id:randomUUID(),label:'Shared fixture',instruction:'Accommodate submitted hard constraints.'},{id:randomUUID(),label:'Optional fixture',instruction:'Explore optional group time without violating restrictions.'}];
 await as(owner,'select create_trip_decision($1,1,$2,$3,$4,$5::jsonb,\'day\',1,\'unanimous\',null,$6::jsonb)',[secret,decision,base,'Published-chain decision fixture',JSON.stringify({kind:'question',source:'member',title:'Fixture planning question',evidence:[]}),JSON.stringify(options)]);
 const runs=[];
 for(const option of options){const token=randomUUID();await as(owner,'select claim_decision_option($1,$2,$3,$4)',[secret,decision,option.id,token]);const d=(await as(owner,'select decision_round_state($1) s',[decision])).rows[0].s;
  const run=await rpc(owner,'begin',{trip_id:'1',version_id:base,operation:'revision',input:`Source action: group_decision. ${option.instruction}`});runs.push(run);
  const output=JSON.stringify({activities:[{day_number:1,position:0,start_time:'11:00',title:option.label,description:'Deterministic isolated fixture, not a live AI result.',location:'Fixture'}],explanation:'Fixture supports the submitted context with a reviewed tradeoff.',uncertainties:['Hours are unverified.']});
  for(let step=1;step<=3;step++)await rpc(owner,'step',{id:run.id,step,text:step===3?output:'Fixture',model:'fixture',prompt:'Fixture',duration_ms:1});
  const proposal=await rpc(owner,'proposal',{id:run.id,scope:'day',day:1,instruction:option.instruction,snapshot:d.preference_snapshot,trip_context:{...d.trip_context,source_action:'group_decision',group_decision:{round_id:decision,option_id:option.id,token}}});
  assert.equal((await as(owner,'select decision_round_state($1) s',[decision])).rows[0].s.options.find(o=>o.id===option.id).proposal_id,proposal.proposal_id);
  await assert.rejects(()=>as(owner,'select apply_itinerary_proposal(1,$1)',[proposal.proposal_id]));
  await as(owner,'select review_decision_option($1,$2,true)',[decision,option.id]);
 }
 const d=(await as(owner,'select decision_round_state($1) s',[decision])).rows[0].s;assert.equal(d.state,'voting');
 for(const actor of d.electorate)await as(actor,'select vote_trip_decision($1,$2)',[decision,options[0].id]);
 const version=(await as(owner,'select apply_trip_decision($1,$2,true) id',[decision,options[0].id])).rows[0].id;
 const attribution=(await as(owner,'select studio_itinerary_context($1) c',[version])).rows[0].c.generation;
 assert.equal(attribution.run_id,runs[0].id);assert.equal(attribution.publication_id,runs[0].publication_id);
 const records=(await as(owner,'select studio_admin_generations(0) r')).rows[0].r;
 assert.equal(records.rows.find(r=>r.id===runs[0].id).version_id,version);assert.equal(records.rows.find(r=>r.id===runs[1].id).version_id,null);
 assert.equal((await as(owner,'select parent_version_id from itinerary_versions where id=$1',[version])).rows[0].parent_version_id,base);
 console.log('PASS TripSync 3 real PostgreSQL gateway integration: each option pins its actual publication/run, links atomically, cannot bypass voting, preserves parent version and exposes the selected run to existing Admin. Model output is an explicitly labeled fixture.');
}
