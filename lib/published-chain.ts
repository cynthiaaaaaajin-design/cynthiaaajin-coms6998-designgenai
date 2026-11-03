import 'server-only';
import {executeChain,itinerarySchema,proposalSchema,type RuntimeStep} from '@tripsync/chain-runtime';
import {createClient} from './supabase/server';
import type {GenerationContext} from './generation-context';
import {parseActivities} from './itinerary';
import {parseProposal} from './itinerary-editing';

export const publishedChainsEnabled=()=>process.env.TRIPSYNC_STUDIO_ENABLED==='true';
export async function chainGateway(action:string,data:Record<string,unknown>) {
  const secret=process.env.TRIPSYNC_CHAIN_SECRET;
  if(!secret||secret.length<32)throw Error('Published workflow is not configured. Contact the administrator.');
  const client=await createClient();
  const result=await client.rpc('studio_gateway',{p_secret:secret,p_action:action,p_data:data});
  if(result.error)throw Error('Published workflow unavailable. Check the active publication and database setup.');
  return result.data;
}
export async function runPublishedChain(prompt:string,days:number,context:GenerationContext|undefined,proposal=false) {
  if(!context?.tripId||!context.versionId)throw Error('A trip and itinerary context are required.');
  const run=await chainGateway('begin',{trip_id:context.tripId,version_id:context.versionId,operation:context.operation,input:prompt}) as {id:string;snapshot:{steps:RuntimeStep[]}};
  try {
    const result=await executeChain({steps:run.snapshot.steps,input:prompt,apiKey:process.env.GEMINI_API_KEY||'',model:process.env.GEMINI_MODEL||'gemini-3.8-flash',schema:proposal?proposalSchema:itinerarySchema,
      validate:text=>{if(proposal)parseProposal(text,days,context.scope||'trip',context.day??null);else parseActivities(text,days);},
      onStep:async output=>{await chainGateway('step',{id:run.id,...output});},
    });
    return {text:result.text,id:run.id};
  } catch(error) {
    await chainGateway('fail',{id:run.id,error:'AI generation or validation failed.'}).catch(()=>{});
    throw error;
  }
}
