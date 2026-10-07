import 'server-only';

export type GeminiErrorCategory =
  | 'missing_api_key' | 'invalid_api_key' | 'permission_denied'
  | 'rate_limited' | 'invalid_request' | 'model_not_found'
  | 'gemini_unavailable' | 'unknown_error';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

// Only selected error fields are logged, never the request, client, or headers.
// Redact secrets even when a provider echoes them inside a message/body/stack.
function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    const key = process.env.GEMINI_API_KEY;
    return (key ? value.split(key).join('[REDACTED]') : value)
      .replace(/AIza[\w-]+/g, '[REDACTED]')
      .replace(/([?&](?:key|api_key)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
      .replace(/((?:"?(?:api[_-]?key|x-goog-api-key|authorization)"?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[REDACTED]');
  }
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase() === 'stack' && process.env.NODE_ENV !== 'development') continue;
    output[key] = /^(api[_-]?key|x-goog-api-key|authorization|headers)$/i.test(key)
      ? '[REDACTED]' : redact(child, seen);
  }
  seen.delete(value);
  return Array.isArray(value) ? Object.values(output) : output;
}

export async function geminiErrorDetails(error: unknown, stage: string, includeStack = false) {
  const e = record(error);
  const response = record(e.response);
  let responseBody = e.body ?? e.responseBody ?? response.body ?? e.response;
  // Some clients attach a Fetch Response instead of an already-parsed body.
  if (e.response instanceof Response) {
    try { responseBody = await e.response.clone().text(); }
    catch { responseBody = '[Response body unavailable]'; }
  }
  const details = {
    stage,
    name: e.name ?? 'UnknownError',
    message: e.message ?? (typeof error === 'string' ? error : 'Unknown thrown error'),
    status: e.status ?? response.status,
    statusCode: e.statusCode ?? response.statusCode,
    code: e.code,
    responseBody,
    details: e.details,
    responseDetails: response.details,
    responseData: response.data,
    ...(includeStack && process.env.NODE_ENV === 'development' ? { stack: e.stack } : {}),
  };
  return record(redact(details));
}

export async function logGeminiError(error: unknown, stage: string): Promise<GeminiErrorCategory> {
  const e = record(error);
  const safeDetails = await geminiErrorDetails(error, stage, true);
  const text = JSON.stringify(safeDetails);
  const status = Number(safeDetails.status ?? safeDetails.statusCode ?? e.code);
  let category: GeminiErrorCategory = 'unknown_error';
  if (e.code === 'MISSING_API_KEY') category = 'missing_api_key';
  else if (status === 401 || /API_KEY_INVALID|API key not valid|invalid api.?key|api.?key.*(?:expired|revoked)/i.test(text)) category = 'invalid_api_key';
  else if (status === 403 || /PERMISSION_DENIED/i.test(text)) category = 'permission_denied';
  else if (status === 429 || /RESOURCE_EXHAUSTED|rate.?limit/i.test(text)) category = 'rate_limited';
  else if (status === 404 || /model.*(?:not found|not supported)|NOT_FOUND/i.test(text)) category = 'model_not_found';
  else if (status === 400 || /INVALID_ARGUMENT|INVALID_REQUEST/i.test(text)) category = 'invalid_request';
  else if (status >= 500 || /UNAVAILABLE|DEADLINE_EXCEEDED|timeout|timed out|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND/i.test(text)) category = 'gemini_unavailable';
  console.error('[Gemini generation error]', JSON.stringify({ category, ...record(safeDetails) }, null, 2));
  return category;
}
