// Compatibility entry point: revisions now use the same preview/apply contract.
// POST requires an explicit base_version_id and scope; it never publishes a version.
export { POST, PATCH } from '../proposals/route';
export const runtime = 'nodejs';
export const maxDuration = 120;
