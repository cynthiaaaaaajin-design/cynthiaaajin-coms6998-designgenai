# Community traveler photos

Users upload their own photos at the bottom of a published Community itinerary. JPG, PNG and WebP files up to 4 MB are accepted; captions are limited to 300 characters. Each person can submit up to 20 photos per publication, including removed photos. This limits submissions, not unregistered direct Storage uploads.

Admin → Content & Feedback → Traveler photos (`/manage/images`) opens the pending queue by default. Filter by status or search by trip, uploader or caption. Review the photo and caption, select a decision, optionally add a note to the uploader, and save.

- Pending: visible only to the uploader and administrators.
- Approved: public while its Community publication is published.
- Rejected / Hidden: no public access through new gallery or signed-URL requests. The uploader can read the moderator's note.
- Removed: recoverable removal, not permanent binary erasure. The uploader can remove their own photo; administrators can restore it to Pending.
- Editing a pending or approved caption resets the photo to Pending. Users cannot edit rejected or moderator-hidden photos to bypass a decision.
- Review requests include the row's update timestamp. A stale review cannot approve a newer caption.

Storage is private. Signed previews last 60 seconds; a link already issued may remain valid until it expires after hiding/removal. The frontend refreshes its gallery every 45 seconds while visible. Moderation notes and uploader UUIDs are not included in public gallery responses. Images are not EXIF-stripped; uploaders should avoid photos containing private metadata or private information. Reviewers should treat captions and photos as untrusted user content.

## Setup and checks

Apply `sql/community-traveler-photos.sql` once after the Week 6 migration. This migration has already been applied to the connected project, including the review concurrency check. Do not rerun it on that project. Deploy both the main and Admin applications; no new secret environment variables are required.

`npm run test:photos` verifies isolated PostgreSQL role checks, pending privacy, storage reads, ownership, approval, stale-review denial, caption re-review, rejection, publication hiding, removal, restoration and input bounds. Both applications passed lint and production webpack builds. Existing Community tests passed.

Live verification on October 28, 2026:

1. The user manually uploaded a JPG on the local frontend; automatic file selection remained blocked by Chrome extension permissions.
2. Admin could preview the pending image. An anonymous HTTP request returned zero photos.
3. Admin approved it. The anonymous API returned one approved photo with a signed preview and an empty moderator note.
4. Admin hid it. The anonymous API immediately returned zero photos again.
5. Test photo `21d5f0bf-2bec-49f0-9ac0-5530ea341b7f` is retained Hidden under Winter Vacation, publication `c3922082-dfc6-4fc8-ba50-e1b9f00ded2c`.

The previous standalone Admin image-upload UI has been replaced with this traveler-photo moderation queue. Existing `admin-images` storage and its legacy metadata are retained; they are not exposed by this new gallery.
