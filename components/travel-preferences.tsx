'use client';
import { useState, useRef, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Person, PreferenceRow } from '@/lib/collaboration';
export function TravelPreferences({ tripId, userId, people, preferences, error, children }: {
  tripId: string; userId: string; people: Person[]; preferences: PreferenceRow[]; error: boolean; children?: ReactNode;
}) {
  const mine = preferences.find(row => row.user_id === userId);
  const router = useRouter();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = new FormData(event.currentTarget);
    const data: Record<string, unknown> = Object.fromEntries(form);
    data.budget_amount = form.get('budget_amount') === '' ? null : Number(form.get('budget_amount'));
    for (const key of ['must_visit_places', 'interests', 'hard_constraints']) data[key] = String(form.get(key) ?? '').split('\n').map(s => s.trim()).filter(Boolean);
    lock.current = true; setBusy(true); setFailure(''); setMessage('');
    try {
      const response = await fetch(`/api/trips/${tripId}/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Preferences could not be saved.');
      setMessage('Your preferences are saved.'); setEditing(false); router.refresh();
    } catch (e) { setFailure(e instanceof Error ? e.message : 'Unable to connect. Try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="settings-card generation-section travel-preferences mt-8" aria-labelledby="travel-preferences-heading">
    <h2 id="travel-preferences-heading" className="text-2xl font-semibold">Travel preferences</h2>
    <p className="mt-2 text-sm text-slate-500">Tell your group what matters most to you.</p>
    {error ? <p className="notice mt-3" role="alert">Preferences are unavailable. Check the collaboration migration and refresh.</p> : <>
      <p className="mt-3 text-sm">{preferences.length} of {people.length} travelers have shared their preferences.</p>
      <div className="feedback-progress-track mt-3" role="progressbar" aria-label="Travel preferences participation" aria-valuemin={0} aria-valuemax={people.length} aria-valuenow={preferences.length}>
        <div className="feedback-progress-fill" style={{ transform: `scaleX(${people.length ? preferences.length / people.length : 0})` }} />
      </div>
      <p className="mt-3 text-xs text-slate-500">{mine ? 'Your preferences: submitted' : 'Your preferences: not submitted yet'}</p>
      <button type="button" className="button-secondary mt-3" aria-expanded={editing} onClick={() => { setEditing(!editing); setMessage(''); }}>{editing ? 'Close preferences' : mine ? 'Edit my preferences' : 'Add my preferences'}</button>
      {editing && <form className="mt-5" onSubmit={save}>
        <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
          <legend className="sr-only">My travel preferences</legend>
          <label>Budget amount (optional)<input name="budget_amount" type="number" min="0" max="1000000000" step="any" defaultValue={mine?.budget_amount ?? ''} /></label>
          <label>Currency<input name="budget_currency" required pattern="[A-Z]{3}" maxLength={3} placeholder="USD" defaultValue={mine?.budget_currency ?? 'USD'} /></label>
          <label>Budget scope<select name="budget_scope" defaultValue={mine?.budget_scope ?? 'per_person_total'}><option value="per_person_total">Per person for the trip</option><option value="per_person_day">Per person per day</option></select></label>
          <label>Travel pace<select name="travel_pace" defaultValue={mine?.travel_pace ?? 'balanced'}><option value="relaxed">Relaxed</option><option value="balanced">Balanced</option><option value="packed">Packed</option></select></label>
          <label className="md:col-span-2">Budget notes<textarea name="budget_notes" rows={2} maxLength={2000} placeholder="For example, excludes flights" defaultValue={mine?.budget_notes ?? ''} /></label>
          {(['must_visit_places', 'interests', 'hard_constraints'] as const).map(key => <label key={key} className={key === 'hard_constraints' ? 'md:col-span-2' : ''}>
            {{ must_visit_places: 'Must-visit places', interests: 'Interests', hard_constraints: 'Hard constraints / things you cannot accept' }[key]}
            <textarea name={key} rows={3} maxLength={9029} defaultValue={mine?.[key].join('\n') ?? ''} placeholder={key === 'hard_constraints' ? 'For example: I cannot walk more than 3 km per day.' : 'One entry per line'} />
            <span className="mt-1 block text-xs font-normal text-slate-500">{key === 'hard_constraints' ? 'Requirements the plan must respect, distinct from ordinary preferences. ' : ''}One entry per line; up to 30 entries of 300 characters.</span>
          </label>)}
          <label className="md:col-span-2">Additional notes<textarea name="additional_notes" rows={2} maxLength={2000} defaultValue={mine?.additional_notes ?? ''} /></label>
          <div><button className="button-primary" type="submit">{busy ? 'Saving…' : 'Save preferences'}</button></div>
        </fieldset>
      </form>}
      {preferences.length > 0 && <details className="feedback-details mt-4"><summary>View group preferences</summary><ul className="divide-y divide-slate-200">
        {preferences.map(row => <li key={row.user_id} className="py-3 text-sm break-words">
          <strong>{people.find(p => p.user_id === row.user_id)?.name || `Traveler ${row.user_id.slice(0, 8)}`}{row.user_id === userId ? ' (you)' : ''}</strong>
          <p className="mt-1">Budget: {row.budget_amount === null ? 'Not specified' : `${row.budget_currency} ${row.budget_amount} ${row.budget_scope === 'per_person_day' ? 'per person per day' : 'per person for the trip'}`} · Pace: {row.travel_pace}</p>
          {row.budget_notes && <p className="whitespace-pre-wrap">Budget notes: {row.budget_notes}</p>}
          {(['must_visit_places', 'interests', 'hard_constraints'] as const).map(key => row[key].length > 0 && <p key={key} className="mt-1 whitespace-pre-wrap"><strong>{{ must_visit_places: 'Must-visit places', interests: 'Interests', hard_constraints: 'Hard constraints' }[key]}:</strong> {row[key].join('; ')}</p>)}
          {row.additional_notes && <p className="mt-1 whitespace-pre-wrap">Notes: {row.additional_notes}</p>}
        </li>)}
      </ul></details>}
    </>}
    {message && <p className="mt-3 text-sm text-teal-800" role="status">{message}</p>}
    {failure && <p className="mt-3 text-sm text-red-700" role="alert">{failure}</p>}
    {children && (editing ? <p className="mt-4 text-sm text-slate-500">Save your preferences before generating, or close the form to use the previously saved preferences.</p> : children)}
  </section>;
}
