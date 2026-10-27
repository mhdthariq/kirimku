# Arrival without photo

Assign `transport.arrive_without_photo` in Access / Roles alongside `transport.arrive`.
The new permission is opt-in for non-owner roles; owners retain their existing all-permissions access.
On ACTIVITY transports, Tandai Tiba then displays only the confirmation dialog, without camera or GPS capture.
The API enforces both permissions, transport scope/crew assignment, departure status and concurrent updates.
The arrival audit records `withoutPhoto: true`; no artificial photo, activity or GPS record is created.
Users without the permission continue to submit arrival evidence.

# Search engine setup

Set `NEXT_PUBLIC_SITE_URL=https://your-production-domain` before building production,
then rebuild and deploy. Use the actual public origin, without a path, query or fragment.
Optionally set `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` to the verification
tokens supplied by Google Search Console and Bing Webmaster Tools.

Only the homepage and public tracking form are in `/sitemap.xml`. Internal pages inherit
noindex; API crawling is disallowed. Tracking result requests do not create sitemap entries.
Development, preview and builds without the production origin disable indexing and return an empty sitemap.

After deployment, confirm `/`, `/tracking-paket`, `/robots.txt` and `/sitemap.xml` are publicly
accessible over HTTPS. Submit `/sitemap.xml` to Google Search Console and Bing Webmaster Tools,
and request indexing of the homepage. Publishing these files helps discovery but does not
guarantee indexing, ranking or immediate appearance in search results.

Reference: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
