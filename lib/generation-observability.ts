import 'server-only';
import type { GenerationMetrics } from './generation-metrics';
import { createClient } from './supabase/server';

// Missing migration keeps existing deployments working during rollout. Other
// configuration/authorization errors fail explicitly, rather than bypassing mix.
export async function beginGeneration(kind: 'itinerary' | 'proposal', prompt: string) {
  const client = await createClient();
  const { data, error } = await client.rpc('begin_observed_generation', { p_kind: kind, p_prompt: prompt });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      console.warn('Week 7 migration missing: generation observability is unavailable.');
      return { id: null, prompt, model: process.env.GEMINI_MODEL || 'gemini-3.8-flash' };
    }
    throw new Error('Generation configuration unavailable. Check enabled chains, mix and models.');
  }
  return { id: data.id as string, prompt: data.prompt as string, model: data.model === 'deployment-default' ? process.env.GEMINI_MODEL || 'gemini-3.8-flash' : data.model as string };
}

export async function finishGeneration(id: string | null, response: string, failed: boolean, metrics?: GenerationMetrics) {
  if (!id) return;
  const client = await createClient();
  const args = {
    p_id: id, p_response: response.length > 80000 ? response.slice(0, 80000) + '\n[Log truncated at 80,000 characters]' : response,
    p_error: failed ? 'Generation failed or returned invalid output. See server diagnostics.' : null,
  };
  let { error } = metrics
    ? await client.rpc('finish_observed_generation_metrics', { ...args, p_metrics: metrics })
    : await client.rpc('finish_observed_generation', args);
  if (metrics && error && ['PGRST202', '42883'].includes(error.code)) {
    console.warn('Generation metrics migration missing; saving the original completion log.');
    ({ error } = await client.rpc('finish_observed_generation', args));
  }
  // Do not discard an otherwise successful itinerary if the observability write fails.
  if (error) console.error('Generation observability completion failed:', error.code);
}
