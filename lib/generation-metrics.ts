import type { GenerateContentResponse } from '@google/genai';

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
}
// Preserve the provider's total: it may include thinking/tool tokens as well as output.
export function buildGenerationMetrics(model: string, elapsedMs: number, response?: Pick<GenerateContentResponse, 'modelVersion' | 'usageMetadata'>) {
  const usage = response?.usageMetadata;
  return {
    model,
    model_version: typeof response?.modelVersion === 'string' ? response.modelVersion.slice(0, 200) : null,
    duration_ms: Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.min(86_400_000, Math.round(elapsedMs)) : null,
    input_tokens: count(usage?.promptTokenCount),
    output_tokens: count(usage?.candidatesTokenCount),
    total_tokens: count(usage?.totalTokenCount),
    thinking_tokens: count(usage?.thoughtsTokenCount),
    cached_input_tokens: count(usage?.cachedContentTokenCount),
  };
}
export type GenerationMetrics = ReturnType<typeof buildGenerationMetrics>;
