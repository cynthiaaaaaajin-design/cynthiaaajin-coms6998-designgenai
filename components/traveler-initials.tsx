/** Decorative initials; the adjacent name remains the accessible identity. */
export function TravelerInitials({ name }: { name: string | null | undefined }) {
  const initials = name?.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase() || '↗';
  return <span className="traveler-initials" aria-hidden="true">{initials}</span>;
}
