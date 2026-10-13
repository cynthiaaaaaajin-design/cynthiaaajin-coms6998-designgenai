// Only app trip routes may be carried through OAuth; never accept an external URL.
export function tripDestination(value: unknown): string | null {
  return typeof value === 'string' && /^\/trips(?:\/-?\d{1,19})?$/.test(value) ? value : null;
}
