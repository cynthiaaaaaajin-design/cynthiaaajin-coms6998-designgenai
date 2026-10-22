import type { ItineraryActivity } from './itinerary';
export type CommunityPost = { id: string; title: string; destination: string; description: string; author_name: string; days: number; activities: ItineraryActivity[]; status: string; created_at: string; updated_at: string };
export type CommunityScore = { post_id: string; upvotes: number; downvotes: number; mine: number | null };
export const publicPostFields = 'id,title,destination,description,author_name,days,activities,status,created_at,updated_at';
export const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
