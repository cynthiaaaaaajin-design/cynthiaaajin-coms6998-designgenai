export function tripDurationError(start: string, end: string): string {
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
  return days > 30 ? 'Choose a trip of 30 days or fewer, including your start and end dates, so we can generate your itinerary.' : '';
}

export function parseNewTrip(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter your trip details.');
  const data = input as Record<string, unknown>;
  function text(key: string, label: string, max: number) {
    const value = data[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
    if (value.trim().length > max) throw new Error(`${label} must be at most ${max} characters.`);
    return value.trim();
  }
  const title = text('title', 'Trip name', 200);
  const destination = text('destination', 'Destination', 300);
  const start_date = text('start_date', 'Start date', 10);
  const end_date = text('end_date', 'End date', 10);
  for (const value of [start_date, end_date]) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new Error('Enter valid start and end dates.');
    }
  }
  if (end_date < start_date) throw new Error('End date cannot be before start date.');
  const durationError = tripDurationError(start_date, end_date);
  if (durationError) throw new Error(durationError);
  return { title, destination, start_date, end_date };
}
