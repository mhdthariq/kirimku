# Camera evidence photos

New photos use the active company's name at the top left, a GPS accuracy badge,
and a green trip/address/vehicle/driver card. The final line is plain text:
`By NovaLogistik`. Existing photos are unchanged. The card is baked into the JPEG;
short landscape photos get extra height so the header and card remain separate.

Native/submitted `locationLabel` values take precedence. When absent, the server
uses Nominatim reverse geocoding. Activity reports also store the resolved address.
Lookup failure or throttling leaves coordinates and an address-unavailable label;
it never prevents saving a photo. OpenStreetMap attribution appears above the byline.

The MVP defaults to the online endpoint. To use a hosted or self-hosted instance,
set this server environment variable and restart:

```env
NOMINATIM_URL=https://nominatim.example.com
```

Provide the base URL, without `/reverse`. Coordinates are sent to that service.
Successful results are cached for 24 hours (up to 1,000 locations per process).
Requests are limited to one every 1.1 seconds; busy captures retain GPS only.
Use one server process for the MVP; add shared caching/rate limiting before replicas.

The [public endpoint policy](https://operations.osmfoundation.org/policies/nominatim/)
requires identification, attribution, caching, and at most one request per second
across the application. It excludes package/vehicle tracking applications, so the
online default may be blocked for this logistics use. Use your own instance or a
provider whose terms permit this use before depending on address lookup in production.
