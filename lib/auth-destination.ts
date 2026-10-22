// Only explicitly allowed internal routes may be carried through OAuth.
export function tripDestination(value: unknown): string | null {
  return typeof value === 'string' && (/^\/trips(?:\/-?\d{1,19})?$/.test(value) || /^\/invite\/[0-9a-f]{64}$/.test(value) || /^\/community(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/.test(value)) ? value : null;
}
