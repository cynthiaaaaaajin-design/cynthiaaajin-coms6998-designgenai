'use client';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { asDraft, changeSummary, orderDraft, parseProposal, validateDraft, type EditableActivity, type Proposal, type SavedActivity } from '@/lib/itinerary-editing';
import type { Person } from '@/lib/collaboration';
import { PlanningStatus } from './planning-status';

export function ItineraryWorkspace({tripId,versionId,items,days,isOwner,isCurrent,proposals,people,changed,loadError,children}: {
  tripId:string;versionId:string;items:SavedActivity[];days:number;isOwner:boolean;isCurrent:boolean;
  proposals:Proposal[];people:Person[];changed:boolean|null;loadError:boolean;children:ReactNode;
}) {
  const router=useRouter();
  const [draft,setDraft]=useState<EditableActivity[]|null>(null);
  const [before,setBefore]=useState<EditableActivity[]>([]);
  const base=useRef(versionId);
  const [preview,setPreview]=useState(false);
  const [busy,setBusy]=useState('');
  const lock=useRef(false);
  const [error,setError]=useState('');
  const [stale,setStale]=useState(false);
  const [message,setMessage]=useState('');
  const [aiOpen,setAiOpen]=useState(false);
  const [scope,setScope]=useState('day');
  const [targetDay,setTargetDay]=useState(1);
  const [targetItem,setTargetItem]=useState(items[0]?.id ?? '');
  const [instruction,setInstruction]=useState('');
  const dayNumbers=Array.from({length:days},(_,i)=>i+1);
  const selectedItem = items.find(i=>i.id===targetItem) ?? items[0];
  const selectedDay = Math.min(Math.max(targetDay,1),Math.max(days,1));
  function startEditing() {
    base.current=versionId; setBefore(asDraft(items));setDraft(asDraft(items));setPreview(false);setError('');setStale(false);setMessage('');
  }
  function discard() {setDraft(null);setPreview(false);setError('');setStale(false);}
  function update(index:number,patch:Partial<EditableActivity>) {setDraft(current=>current ? orderDraft(current.map((a,i)=>i===index?{...a,...patch}:a)):current);}
  function move(index:number,offset:number) {
    setDraft(current=>{
      if(!current || !current[index+offset] || current[index].day_number!==current[index+offset].day_number) return current;
      const next=[...current];[next[index],next[index+offset]]=[next[index+offset],next[index]];return orderDraft(next);
    });
  }
  async function send(path:string,body:unknown,method='POST') {
    const response=await fetch(`/api/trips/${tripId}/${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok) {if(response.status===409)setStale(true);throw new Error(result.error || 'Changes could not be saved.');}
    return result;
  }
  async function save() {
    if(!draft || lock.current) return;
    lock.current=true;setBusy('save');setError('');
    try {
      const activities=validateDraft(draft,days);
      const result=await send('edit',{base_version_id:base.current,activities});
      setDraft(null);setPreview(false);router.push(`/trips/${tripId}?version=${result.versionId}`,{scroll:false});router.refresh();
    } catch(e) {setError(e instanceof Error?e.message:'Save failed. Your draft is still available.');}
    finally {lock.current=false;setBusy('');}
  }
  function showPreview(event:FormEvent) {
    event.preventDefault();setError('');
    try {validateDraft(draft,days);setPreview(true);} catch(e) {setError(e instanceof Error?e.message:'Check activity fields.');}
  }
  async function requestAI(event:FormEvent) {
    event.preventDefault();if(lock.current) return;
    lock.current=true;setBusy('ai');setError('');setStale(false);setMessage('');
    const selected=selectedItem;
    try {
      await send('proposals',{base_version_id:versionId,scope,day:scope==='activity'?selected?.day_number:selectedDay,item_id:selected?.id,instruction});
      setMessage('AI proposal saved below. Review Before / After before applying.');router.refresh();
    } catch(e) {setError(e instanceof Error?e.message:'AI proposal failed.');}
    finally {lock.current=false;setBusy('');}
  }
  async function apply(id:string) {
    if(lock.current)return;
    lock.current=true;setBusy(id);setError('');setStale(false);
    try {
      const result=await send('proposals',{proposal_id:id},'PATCH');
      router.push(`/trips/${tripId}?version=${result.versionId}`,{scroll:false});router.refresh();
    } catch(e) {setError(e instanceof Error?e.message:'Proposal could not be applied.');}
    finally {lock.current=false;setBusy('');}
  }
  const changes=draft?changeSummary(before,draft):[];
  const pending=proposals.filter(p=>!p.applied_version_id);
  function plan(list: {day_number:number;start_time:string|null;title:string;description:string|null;location:string|null}[]) {
    return <ul className="mt-2 space-y-3">{list.map((a,i)=><li key={i} className="break-words text-sm"><strong>Day {a.day_number} · {a.start_time?.slice(0,5) || 'Flexible'} · {a.title}</strong>{a.location&&<p>{a.location}</p>}{a.description&&<p className="whitespace-pre-wrap text-slate-600">{a.description}</p>}</li>)}</ul>;
  }
  return <>
    {loadError && <p className="notice mt-4" role="alert">Editing and AI proposal data could not be loaded. Check the Phase 3 migration and refresh.</p>}
    {isCurrent && !draft && <div id="ai-revisions" className="mt-5">
      <div className="flex flex-wrap gap-2">
        <button className="button-secondary" disabled={!!busy||loadError} onClick={startEditing}>Edit itinerary</button>
        <button className="button-secondary" disabled={!!busy||loadError} aria-expanded={aiOpen} onClick={()=>setAiOpen(!aiOpen)}>Ask AI to revise a day or activity</button>
      </div>
      {isOwner && !loadError && <div className="mt-4">
        {changed===true && <p className="text-sm font-semibold">Travel preferences have changed.</p>}
        {changed===null && <p className="text-sm text-slate-500">This plan has no saved preference snapshot. Regenerate to use the latest group preferences.</p>}
        {(changed===true||changed===null) && <button className="button-secondary mt-2" disabled={!!busy} onClick={()=>{setScope('trip');setInstruction('Generate a new itinerary using the latest group preferences. Respect all hard constraints and explain conflicts.');setAiOpen(true);}}>Regenerate with updated preferences</button>}
      </div>}
      {aiOpen && <form className="settings-card mt-4" onSubmit={requestAI}>
        <fieldset disabled={!!busy} className="grid gap-4 md:grid-cols-2"><legend className="sr-only">AI revision request</legend>
          <label>Revise<select className="phase3-select" value={scope} onChange={e=>setScope(e.target.value)}><option value="day">One day</option><option value="activity">One activity</option>{isOwner&&<option value="trip">Whole trip — preview first</option>}</select></label>
          {scope==='day'&&<label>Day<select className="phase3-select" value={selectedDay} onChange={e=>setTargetDay(Number(e.target.value))}>{dayNumbers.map(d=><option key={d} value={d}>Day {d}</option>)}</select></label>}
          {scope==='activity'&&<label>Activity<select className="phase3-select" value={selectedItem?.id ?? ''} onChange={e=>setTargetItem(e.target.value)}>{items.map(a=><option key={a.id} value={a.id}>Day {a.day_number}: {a.title}</option>)}</select></label>}
          <label className="md:col-span-2">What would you like to change?<textarea required maxLength={2000} rows={3} value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="Make this day more relaxed, or find a cheaper alternative…" /></label>
          <div className="md:col-span-2"><p className="mb-3 text-xs text-slate-500">Uses current group preferences and feedback. The current plan stays unchanged until the owner applies a proposal.</p><button className="button-primary" type="submit">{busy==='ai'?'Preparing proposal…':'Preview AI changes'}</button></div>
        </fieldset>
      </form>}
    </div>}
    {busy==='ai'&&<PlanningStatus revision />}
    {message&&<p role="status" className="mt-3 text-sm text-teal-800">{message}</p>}
    {error&&<p role="alert" className="notice mt-3">{error}</p>}
    {stale&&<a href={`/trips/${tripId}`} target="_blank" rel="noopener noreferrer" className="button-secondary mt-3">Review latest itinerary in a new tab</a>}
    {draft ? <section className="mt-6" aria-label="Itinerary draft">
      <p className="notice">Draft only — your changes are not published. {preview?'Review the summary before saving a new version.':'Edit activities below, then preview your changes.'}</p>
      {preview ? <>
        <h3 className="mt-4 text-lg font-semibold">Proposed changes</h3>
        {dayNumbers.map(day=>changes.some(c=>c.day===day)&&<div key={day} className="mt-4"><p className="day-label">DAY {day}</p><ul className="mt-2 space-y-2 text-sm">{changes.filter(c=>c.day===day).map((c,i)=><li key={i}><strong>{c.kind}:</strong> {c.text}</li>)}</ul></div>)}
        {!changes.length&&<p className="mt-3 text-sm">No changes to save.</p>}
        <div className="mt-4 flex flex-wrap gap-2"><button className="button-primary" disabled={!!busy||!changes.length||stale} onClick={save}>{busy==='save'?'Saving…':'Save new version'}</button><button className="button-secondary" disabled={!!busy} onClick={()=>setPreview(false)}>Continue editing</button><button className="button-secondary" disabled={!!busy} onClick={discard}>Discard changes</button></div>
      </> : <form onSubmit={showPreview}>
        <fieldset disabled={!!busy}><legend className="sr-only">Edit itinerary activities</legend>
          {dayNumbers.map(day=><section key={day} className="itinerary-version itinerary-day mt-8"><h3 className="day-label mb-4 text-lg font-semibold">DAY {String(day).padStart(2,'0')}</h3>
            <ol className="itinerary-timeline">{draft.map((a,index)=>a.day_number===day&&<li key={a.source_item_id??`new:${index}`} className="activity-card timeline-activity">
              <label className="timeline-time text-sm">Time<input type="time" value={a.start_time??''} onChange={e=>update(index,{start_time:e.target.value||null})} /></label>
              <div className="min-w-0 flex-1"><div className="grid gap-3 md:grid-cols-2">
                <label>Activity title<input required maxLength={200} value={a.title} onChange={e=>update(index,{title:e.target.value})}/></label>
                <label>Day<select className="phase3-select" value={a.day_number} onChange={e=>update(index,{day_number:Number(e.target.value)})}>{dayNumbers.map(d=><option key={d} value={d}>Day {d}</option>)}</select></label>
                <label className="md:col-span-2">Location<input maxLength={2000} value={a.location??''} onChange={e=>update(index,{location:e.target.value||null})}/></label>
                <label className="md:col-span-2">Description<textarea rows={2} maxLength={2000} value={a.description??''} onChange={e=>update(index,{description:e.target.value||null})}/></label>
              </div><div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="button-secondary" disabled={a.position===0} onClick={()=>move(index,-1)} aria-label={`Move ${a.title} earlier`}>Move up</button>
                <button type="button" className="button-secondary" disabled={draft[index+1]?.day_number!==day} onClick={()=>move(index,1)} aria-label={`Move ${a.title} later`}>Move down</button>
                <button type="button" className="button-secondary" onClick={()=>setDraft(orderDraft(draft.filter((_,i)=>i!==index)))}>Remove activity</button>
              </div></div>
            </li>)}</ol>
            <button type="button" className="button-secondary mt-3" disabled={draft.length>=120} onClick={()=>setDraft(orderDraft([...draft,{source_item_id:null,day_number:day,position:0,start_time:null,title:'',description:null,location:null}]))}>Add activity to Day {day}</button>
          </section>)}
          <div className="mt-5 flex flex-wrap gap-2"><button className="button-primary" type="submit">Save changes</button><button className="button-secondary" type="button" onClick={discard}>Discard changes</button></div>
        </fieldset>
      </form>}
    </section> : <>
      {proposals.length>0&&<details className="settings-card mt-5"><summary className="cursor-pointer font-semibold">AI proposals · {pending.length} awaiting review{!isCurrent?' · Historical version':''}</summary>
        {proposals.map(p=>{
          let proposed;try{proposed=parseProposal(p.response_text,days,p.scope,p.target_day);}catch{return <p key={p.id} className="notice mt-3">This proposal cannot be displayed. Request a new one.</p>;}
          const selected=items.filter(a=>p.scope==='trip'||(p.scope==='day'?a.day_number===p.target_day:a.id===p.target_item_id));
          return <details key={p.id} className="feedback-details mt-4"><summary>{p.scope==='trip'?'Whole trip':p.scope==='day'?`Day ${p.target_day}`:selected[0]?.title||'Activity'} · {people.find(person=>person.user_id===p.created_by)?.name||'Traveler'} · {p.applied_version_id?'Applied':'Proposal'}</summary>
            <p className="mt-3 whitespace-pre-wrap text-sm">Request: {p.instruction}</p><p className="mt-2 whitespace-pre-wrap text-sm">{proposed.explanation}</p>
            <p className="mt-2 text-sm text-slate-500">{items.length-selected.length} activities outside this selection remain unchanged. Existing votes and suggestions stay with their original version.</p>
            {items.length>selected.length&&<details className="feedback-details mt-2"><summary>Unchanged activities</summary>{plan(items.filter(a=>!selected.some(s=>s.id===a.id)))}</details>}
            {proposed.uncertainties.length>0&&<div className="notice mt-3"><strong>Conflicts / uncertainties</strong><ul>{proposed.uncertainties.map((u,i)=><li key={i} className="whitespace-pre-wrap">{u}</li>)}</ul></div>}
            <div className="mt-4 grid gap-4 md:grid-cols-2"><div><h4 className="font-semibold">Before</h4>{plan(selected)}</div><div><h4 className="font-semibold">After</h4>{plan(proposed.activities)}</div></div>
            {p.applied_version_id?<a className="button-secondary mt-4" href={`/trips/${tripId}?version=${p.applied_version_id}`}>View published version</a>:isCurrent&&isOwner?<button className="button-primary mt-4" disabled={!!busy||loadError} onClick={()=>apply(p.id)}>{busy===p.id?'Applying…':'Apply changes'}</button>:<p className="mt-3 text-xs text-slate-500">{isCurrent?'Only the trip owner can apply this proposal.':'This proposal belongs to an earlier version and cannot be applied.'}</p>}
          </details>;
        })}
      </details>}
      {children}
    </>}
  </>;
}
