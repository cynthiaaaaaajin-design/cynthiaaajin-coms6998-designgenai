import {collaborationAccess,collaborationBody,collaborationJson as json} from '@/lib/collaboration-route';
import {parseReservation} from '@/lib/reservations';
import {uuid} from '@/lib/collaboration';
type C={params:Promise<{tripId:string}>};
export async function GET(r:Request,{params}:C){try{const {tripId}=await params;const a=await collaborationAccess(r,tripId);if(a instanceof Response)return a;const result=await a.client.from('trip_reservations').select('*').eq('trip_id',tripId).order('created_at');if(result.error)throw Error();return json({reservations:result.data});}catch{return json({error:'Travel details unavailable. Check the reservations migration.'},503);}}
async function write(r:Request,c:C){try{const {tripId}=await c.params;const a=await collaborationAccess(r,tripId);if(a instanceof Response)return a;const b=await collaborationBody(r,15000) as Record<string,unknown>;let q;
 if(r.method==='DELETE')q=a.client.from('trip_reservations').delete().eq('id',uuid(b.id)).eq('trip_id',tripId).select('id');
 else{const value=parseReservation(b);q=r.method==='PATCH'?a.client.from('trip_reservations').update({...value,updated_at:new Date().toISOString()}).eq('id',uuid(b.id)).eq('trip_id',tripId).select('id'):a.client.from('trip_reservations').insert({...value,id:uuid(b.id),trip_id:tripId,created_by:a.user.id}).select('id');}
 const result=await q;if(result.error||!result.data?.length)return json({error:'Could not save changes. Check your permissions and retry.'},409);return json({saved:true});
 }catch(e){return json({error:e instanceof Error?e.message:'Invalid reservation.'},400);}}
export const POST=write;export const PATCH=write;export const DELETE=write;
