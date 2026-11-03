import {createClient} from '@/lib/supabase/server';
import {validTripId} from '@/lib/itinerary';
export async function POST(request:Request,{params}:{params:Promise<{tripId:string}>}) {
  const {tripId}=await params;
  if(!validTripId(tripId))return Response.json({error:'Invalid trip.'},{status:400});
  if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403});
  const client=await createClient();const {data:{user}}=await client.auth.getUser();
  if(!user)return Response.json({error:'Sign in to rate an itinerary.'},{status:401});
  try {
    const text=await request.text();if(text.length>4000)throw Error('Feedback is too long.');
    const b=JSON.parse(text);
    if(typeof b.versionId!=='string'||!/^[0-9a-f-]{36}$/i.test(b.versionId)||!Number.isInteger(b.rating)||b.rating<1||b.rating>5||typeof b.comment!=='string'||b.comment.length>1000)throw Error('Choose a rating from 1 to 5 and use at most 1,000 characters.');
    const {data:version,error}=await client.from('itinerary_versions').select('id').eq('id',b.versionId).eq('trip_id',tripId).maybeSingle();
    if(error||!version)return Response.json({error:'Itinerary unavailable.'},{status:403});
    const result=await client.rpc('studio_rate_itinerary',{p_version:b.versionId,p_rating:b.rating,p_comment:b.comment});
    if(result.error)return Response.json({error:'Rating unavailable. Check trip access and database setup.'},{status:403});
    return Response.json({saved:true},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Invalid feedback.'},{status:400});}
}
