// Only exact internal trip and invitation routes may be carried through OAuth.
export function tripDestination(value: unknown): string | null {
  return typeof value === 'string' && (/^\/trips(?:\/-?\d{1,19})?$/.test(value) || /^\/invite\/[0-9a-f]{64}$/.test(value)) ? value : null;
}
