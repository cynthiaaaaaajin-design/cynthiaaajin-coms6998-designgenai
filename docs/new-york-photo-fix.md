# NYC destination photo matching fix — November 4, 2026

Observed issue: both new NYC weekend collection cards showed the fallback illustration. The saved destination was New York City, USA. A real Google Places Text Search call returned HTTP 200, displayName New York, types locality/political and ten photo references. The previous strict normalized display-name equality rejected New York versus New York City before requesting media. This was an application matching bug, not a missing API integration.

Fix: register known NYC aliases without changing the existing canonical New York City, USA destination. Request places.types and permit a known city alias only when Google classifies the result as a locality. Similarly named retail businesses, unknown locations and explicit different destinations (New York, Texas) are not accepted through this alias path. Existing attribution, server-only API keys, media host checks, limits, no-store behavior and local illustration fallback remain.

Executed checks: destination/illustration normalization tests including NYC/NYC aliases and New York, Texas; destination-photo regression tests including Google's actual shortened city name and rejection of business/missing-type alias results; ESLint. Real corrected code completed search, media metadata and image-byte requests with three HTTP 200 responses, returning a New York image with five available slides and author attribution. No key or photo binary was printed. Initial sandbox DNS failure was retried with network authorization.

Reference: https://developers.google.com/maps/documentation/places/web-service/choose-fields

Production webpack build including TypeScript passed. The fix changes no trip, preference, prompt-chain, generated itinerary or feedback records.
