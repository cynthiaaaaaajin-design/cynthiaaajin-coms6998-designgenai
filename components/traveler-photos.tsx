/* eslint-disable @next/next/no-img-element -- Short-lived signed URLs from private Storage. */
'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
type Photo = { id: string; caption: string; status: string; author_name: string; mine: boolean; url: string | null; moderation_note: string };
const labels: Record<string,string> = { pending: 'Pending review', approved: 'Approved', rejected: 'Not approved', hidden: 'Hidden by moderator', removed: 'Removed' };
export function TravelerPhotos({ postId, signedIn }: { postId: string; signedIn: boolean }) {
 const [rows, setRows] = useState<Photo[]>([]); const [page, setPage] = useState(0); const [total,setTotal] = useState(0);
 const [error,setError] = useState(''); const [message,setMessage] = useState(''); const [busy,setBusy] = useState(false); const [loading,setLoading] = useState(true);
 const load = useCallback(async () => {
  try { const response = await fetch(`/api/community/${postId}/photos?page=${page}`, { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setRows(data.rows); setTotal(data.total); setError(''); }
  catch (e) { setError(e instanceof Error ? e.message : 'Could not load photos.'); } finally { setLoading(false); }
 },[postId,page]);
 useEffect(() => { const initial=window.setTimeout(()=>void load(),0); const timer=window.setInterval(()=>{if(!document.hidden) void load();},45000); return ()=>{window.clearTimeout(initial);window.clearInterval(timer);}; },[load]);
 async function send(body: FormData | object, success: string, form?: HTMLFormElement) {
  setBusy(true); setError(''); setMessage('');
  try { const response=await fetch(`/api/community/${postId}/photos`,{method:'POST',...(body instanceof FormData ? {body} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}); const data=await response.json(); if(!response.ok) throw new Error(data.error); form?.reset(); setMessage(success); await load(); }
  catch(e){setError(e instanceof Error?e.message:'Could not save photo.');} finally{setBusy(false);}
 }
 return <section className="traveler-photos" aria-labelledby="traveler-photos-title">
  <p className="eyebrow">THROUGH YOUR LENS</p><h2 id="traveler-photos-title">Traveler photos</h2>
  <p>Been here? Share your own photos and a little of the story. Photos appear publicly after an administrator approves them.</p>
  {signedIn ? <form className="traveler-photo-upload" onSubmit={event=>{event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const file=data.get('file');if(!(file instanceof File)||!file.size||file.size>4*1024*1024){setError('Choose an image up to 4 MB.');return;}void send(data,'Photo submitted. Only you and administrators can see it until approval.',form);}}>
   <label>Your photo<input name="file" type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy}/></label>
   <label>Caption<textarea name="caption" maxLength={300} placeholder="Where was this taken? What did you enjoy?" disabled={busy}/></label>
   <p className="text-sm text-slate-500">Your own travel photos only · JPG, PNG or WebP · up to 4 MB · 20 uploads per person per trip. Avoid personal documents and other people’s private information. Removed photos leave the public gallery; administrators can restore them.</p>
   <button className="button-primary" disabled={busy}>{busy?'Saving…':'Submit for review'}</button>
  </form> : <p><Link className="text-teal-800 underline" href={`/?next=${encodeURIComponent(`/community/${postId}`)}`}>Sign in to share your travel photos</Link></p>}
  {error&&<p className="notice" role="alert">{error}<button type="button" className="ml-3 underline" onClick={()=>void load()}>Retry</button></p>}{message&&<p className="notice" role="status">{message}</p>}
  {loading?<p>Loading traveler photos…</p>:!error&&rows.length===0?<p className="traveler-photo-empty">No photos yet. Be the first to share a moment from this trip.</p>:null}
  <div className="traveler-photo-grid">{rows.map(photo=><article className="traveler-photo-card" key={photo.id}>
   {photo.url&&photo.status!=='removed'?<a href={photo.url} target="_blank" rel="noopener noreferrer" aria-label={`View photo by ${photo.author_name}`}><img src={photo.url} alt={photo.caption||`Travel photo shared by ${photo.author_name}`}/></a>:<div className="traveler-photo-placeholder">{photo.status==='removed'?'Photo removed':'Preview unavailable'}</div>}
   <div className="traveler-photo-body"><p className="text-sm">Shared by {photo.author_name}{photo.mine?' · You':''}</p><p className="whitespace-pre-wrap">{photo.caption}</p>
    {photo.mine&&<><span className={`photo-status photo-status-${photo.status}`}>{labels[photo.status]}</span>{photo.moderation_note&&<p className="text-sm">Moderator: {photo.moderation_note}</p>}
    {['pending','approved'].includes(photo.status)&&<form onSubmit={event=>{event.preventDefault();void send({id:photo.id,action:'caption',caption:new FormData(event.currentTarget).get('caption')},'Caption updated. This photo needs approval again.');}}><label>Edit caption<textarea key={photo.caption} name="caption" defaultValue={photo.caption} maxLength={300} disabled={busy}/></label><button className="button-secondary" disabled={busy}>Save and resubmit</button></form>}
    {photo.status!=='removed'&&<button className="text-sm underline" disabled={busy} onClick={()=>void send({id:photo.id,action:'remove',caption:''},'Photo removed from the gallery. An administrator can restore it.')}>Remove my photo</button>}</>}
   </div>
  </article>)}</div>
  {total>30&&<div className="traveler-photo-pagination"><button disabled={page===0||busy} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1} · {total} photos</span><button disabled={(page+1)*30>=total||busy} onClick={()=>setPage(p=>p+1)}>Next</button></div>}
 </section>;
}
