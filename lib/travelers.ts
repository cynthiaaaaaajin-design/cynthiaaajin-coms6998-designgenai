export type Traveler = {
  userId: string;
  name: string | null;
  email: string | null;
};

export function travelerEmail(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter a traveler’s email address.');
  const email = (input as Record<string, unknown>).email;
  if (typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error('Enter a valid email address.');
  }
  return email.trim().toLowerCase();
}

export function travelerId(input: unknown): string {
  const id = input && typeof input === 'object' ? (input as Record<string, unknown>).user_id : undefined;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid traveler.');
  }
  return id.toLowerCase();
}
