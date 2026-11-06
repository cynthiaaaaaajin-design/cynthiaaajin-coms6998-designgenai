import {collaborationAccess,collaborationBody,collaborationJson as json} from '@/lib/collaboration-route';
import {allocate,minor,settlement,currencies,type Currency,type Expense} from '@/lib/expenses';
import {uuid} from '@/lib/collaboration';
type C={params:Promise<{tripId:string}>};
export async function GET(r:Request,{params}:C){try{const {tripId}=await params;const a=await collaborationAccess(r,tripId);if(a instanceof Response)return a;
 const [expenses,snapshots,receipts,fingerprint,people]=await Promise.all([a.client.from('trip_expenses').select('*').eq('trip_id',tripId).order('expense_date',{ascending:false}).limit(1000),a.client.from('trip_settlements').select('*').eq('trip_id',tripId).order('created_at',{ascending:false}).limit(100),a.client.from('trip_transfer_receipts').select('settlement_id,transfer_index'),a.client.rpc('expense_cycle_fingerprint',{p_trip:tripId}),a.client.rpc('collaboration_people',{p_trip_id:tripId})]);
 if(expenses.error||snapshots.error||receipts.error||fingerprint.error||people.error)throw Error();
 if(expenses.data.length>=1000)return json({error:'This trip needs paginated ledger export before settlement.'},422);
 return json({expenses:expenses.data,snapshots:snapshots.data,receipts:receipts.data,fingerprint:fingerprint.data,people:people.data,preview:settlement((expenses.data as Expense[]).filter(e=>!e.settlement_id))});
 }catch{return json({error:'Expenses unavailable. Check access and the expenses migration.'},503);}}
export async function POST(r:Request,{params}:C){try{const {tripId}=await params;const a=await collaborationAccess(r,tripId);if(a instanceof Response)return a;const b=await collaborationBody(r,20000) as Record<string,unknown>;let result;
 if(b.action==='finalize'){if(a.trip.user_id!==a.user.id)return json({error:'Only the trip owner may finalize.'},403);if(typeof b.fingerprint!=='string')throw Error('Refresh the settlement preview.');result=await a.client.rpc('finalize_trip_settlement',{p_trip:tripId,p_fingerprint:b.fingerprint});}
 else if(b.action==='paid')result=await a.client.rpc('mark_trip_transfer_paid',{p_trip:tripId,p_settlement:uuid(b.settlement_id),p_index:b.index});
 else if(b.action==='delete')result=await a.client.rpc('save_trip_expense',{p_trip:tripId,p_id:uuid(b.id),p_value:{},p_delete:true});
 else{
  const currency=String(b.currency) as Currency;if(!(currency in currencies))throw Error('Choose a supported currency.');
  if(typeof b.description!=='string'||!b.description.trim()||b.description.length>200||typeof b.amount!=='string'||!['equal','custom','percentage'].includes(String(b.split_method))||!Array.isArray(b.participants)||typeof b.expense_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.expense_date))throw Error('Complete the expense and participant details.');
  const amount=minor(b.amount,currency);const allocations=allocate(amount,b.split_method as 'equal'|'custom'|'percentage',b.participants.map(p=>({user_id:uuid(p.user_id),value:p.value})),currency);
  result=await a.client.rpc('save_trip_expense',{p_trip:tripId,p_id:uuid(b.id),p_value:{description:b.description.trim(),amount,currency,allocations,payer_id:uuid(b.payer_id),split_method:b.split_method,expense_date:b.expense_date,category:b.category,note:b.note??''}});
 }
 if(result.error)return json({error:result.error.code==='40001'?'Expenses changed or already settled. Reload the preview.':'Could not save. Check participants, amounts and permissions.'},409);return json({saved:true,id:result.data});
 }catch(e){return json({error:e instanceof Error?e.message:'Invalid expense.'},400);}}
