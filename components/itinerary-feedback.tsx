'use client';
import {useState,type FormEvent} from 'react';
export function ItineraryFeedback({tripId,versionId,initial}:{tripId:string;versionId:string;initial?:{rating:number;comment:string}|null}) {
  const [rating,setRating]=useState(initial?.rating||0),[comment,setComment]=useState(initial?.comment||'');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function submit(e:FormEvent) {
    e.preventDefault();setBusy(true);setMessage('');
    try {
      const response=await fetch(`/api/trips/${tripId}/feedback`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({versionId,rating,comment})});
      if(!response.ok)throw Error((await response.json()).error||'Feedback could not be saved.');
      setMessage('Rating saved.');
    }catch(error){setMessage(error instanceof Error?error.message:'Feedback could not be saved.');}finally{setBusy(false);}
  }
  return <form onSubmit={submit} className="settings-card mt-5" aria-label="Rate this itinerary"><h3 className="font-semibold">Rate this itinerary</h3><div className="mt-3 flex flex-wrap items-center gap-3"><label>Overall rating <select aria-label="Overall itinerary rating" value={rating} onChange={e=>setRating(Number(e.target.value))} disabled={busy} className="phase3-select"><option value={0}>Choose a rating</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} / 5</option>)}</select></label><button className="button-secondary" disabled={busy||!rating}>{busy?'Saving…':'Save rating'}</button></div><label className="mt-3 block text-sm">Feedback <span className="text-slate-500">(optional)</span><textarea className="phase3-input mt-2 w-full" rows={2} maxLength={1000} value={comment} onChange={e=>setComment(e.target.value)} disabled={busy}/></label>{message&&<p role="status" className="mt-2 text-sm">{message}</p>}</form>;
}
