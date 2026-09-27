# Geographic map provider

The pilot uses Leaflet 1.9.4 (BSD-2-Clause) and OpenStreetMap standard raster tiles. Leaflet supports touch, keyboard navigation and DOM markers; zoom-dependent screen-space groups keep nearby pins selectable. Every group offers individual node selection, including coincident coordinates. The companion list provides an independent accessible path.

OSM attribution stays visible. Tiles load only for the viewport; there is no prefetching, offline download, service-worker tile cache or proxy that strips browser identification. Browser caching remains intact. The tile layer explicitly sends the site origin as its referrer because the host otherwise uses `Referrer-Policy: no-referrer`; page paths and query strings are not sent to the tile provider. The service is best-effort and may block abusive load; list discovery remains available on tile errors.

Incremental paid map-service budget for this implementation: $0. No subscription is created. Before public scale-up, operators must review traffic against the tile usage policy and either confirm a suitable deployment or configure a separately approved commercial/self-hosted tile service. This is not an unlimited free hosting guarantee.

Alternatives considered: a commercial vector basemap would add styling and billing/account operations; a self-hosted tile stack would add substantial operational work. Neither is required for the small curated pilot. Keep tile settings localized in the geographic map component.

References checked during implementation:
- [Leaflet reference](https://leafletjs.com/reference.html)
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
