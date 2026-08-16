# NYC Scaffold Routes

Walking directions for New York City that account for sidewalk scaffolding.

## Initial product concept

After entering a destination, the user chooses a routing preference in the initial destination-picker modal:

- **Min scaffolding:** avoid permitted sidewalk sheds wherever practical.
- **Max scaffolding:** prefer covered/protected sidewalk segments when they are close to the normal route, without substantially increasing total walking distance.

The app should return walking directions granular enough to choose the better side of a street—for example, walking on 20th Street instead of 19th Street when that provides better shelter.

## Prototype assumptions

- Start with a small Manhattan test area rather than all of NYC.
- Use OpenStreetMap for pedestrian street geometry and map display/routing inputs.
- Use NYC Scaffold Permits data as a periodically refreshed source of scaffold locations.
- Treat route length as a constraint or strong penalty, rather than allowing the max-scaffolding route to make a large detour.
- Avoid all known scaffolding for the min-scaffolding route when a reasonable alternative exists.

## Important data questions

The provided permit fields are address/building oriented rather than sidewalk oriented. For this product, the useful initial filter is `permit_subtype = SH` (Sidewalk Shed), combined with `permit_status` and `filing_status` to identify permits that should still be considered active. `SF` is supported scaffold, which is not necessarily a covered pedestrian sidewalk.

The dataset does not directly contain scaffold geometry, shed dimensions, installation dates, or the affected sidewalk side. The first mapping strategy can therefore be:

1. Filter for relevant and active scaffold permits.
2. Deduplicate permits by BIN/address.
3. Match each BIN or address to NYC building footprints and the OpenStreetMap street network.
4. Infer the sidewalk edge alongside the building frontage.
5. Mark the inference as uncertain when a parcel has multiple frontages, a corner lot, or incomplete address matching.

This should be enough for an initial prototype, while keeping the data model ready for more precise scaffold geometry later.

## Likely first prototype

1. Pick a bounded Manhattan neighborhood with enough construction activity to test the idea.
2. Import a snapshot of OpenStreetMap pedestrian data and NYC scaffold permits.
3. Generate ordinary walking routes, then probe nearby parallel-street waypoints so the MVP can compare the street immediately alongside the baseline and the next grid street over.
4. Show two route summaries: distance, estimated time, and scaffolding exposure/coverage.
5. Add periodic permit-data refresh once the routing behavior is credible.

The current parallel-street experiment uses the public OSM foot router with four forced-waypoint probes around the baseline route (about 85 m and 170 m on either side). Candidates are deduplicated and discarded when they exceed the shortest route by more than 12%. This is intentionally a bounded MVP technique: it can discover a better nearby street, but it is not yet a full sidewalk-edge graph.

## Running locally

This MVP is intentionally dependency-free. From this folder, run:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. It can be deployed as a static site on GitHub Pages or Cloudflare Pages at no hosting cost.

## Free GitHub Pages deployment

The repository includes `.github/workflows/deploy-pages.yml`. After pushing this folder to a GitHub repository:

1. Open the repository’s **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Push to the repository’s default branch, or run **Actions → Deploy ScaffoldMaxNYC → Run workflow**.

GitHub will publish the site at `https://<account>.github.io/<repository>/`. The separate refresh workflow runs daily at 06:17 UTC, validates the cache, commits any changed `data/scaffolds.json`, and triggers a new Pages deployment.

The browser now reads `data/scaffolds.json`, a local snapshot of filtered sidewalk-shed permits, so a user route search does not depend on the NYC Open Data API being available. If the snapshot is missing, it falls back to the live API for development. For each route search, the app queries nearby NYC building footprints and joins permits by BIN first, then uses the building edge nearest the walking line as a sidewalk-frontage proxy. Street-name normalization handles forms such as `W 15TH STREET` and `WEST 15 ST`, and neighboring permits can represent a continuous long frontage when the exact street number is not present.

The walking-mode MVP now supports **Use my current location** as the route origin and **Go on selected route** after a route is calculated. Go mode uses the browser Geolocation API, displays a blue position marker plus accuracy circle, follows the selected route, and reports approximate distance remaining. Location access requires `localhost` or an HTTPS deployment; browsers will not grant it from a plain `file://` page. The current-location button should be used before finding the route so the route itself starts from the device position.

For a public beta, this can remain a static site: GitHub Pages or Cloudflare Pages can host the files for free, while GitHub Actions refreshes the cached scaffold data. The next production concerns are HTTPS, mobile layout testing, rate-limited/proxied routing requests, source attribution, privacy language explaining that location is used in the browser and not stored, and eventually a real backend/cache so public users do not share anonymous third-party API limits.

This should reduce false negatives without treating every permit address as a shed along the route. A false positive is still possible when one building has a permit for only one frontage but the footprint fronts several streets; the app therefore describes these as approximate/likely sheds until exact shed geometry or field observations are available.

Route cards now include an estimated covered/uncovered percentage. The estimate sums route segment lengths whose midpoint falls within the building-frontage proxy distance of shed evidence; it is directional guidance, not a measurement of actual shed canopy length.

`data/known-observations.json` is a separate ground-truth layer for field reports and frontage corrections. These markers are purple. The 325 West 15th test case is linked to BIN 1013043, which has `SH` permits filed under 111 8 Avenue; this demonstrates why permit address alone cannot identify all sides of a large building.

Run `python3 scripts/refresh-scaffolds.py` to refresh the snapshot. The script now uses NYC DOB's daily Active Sidewalk Shed map CSV, which includes active-only records, BIN, coordinates, permit expiration, and `Sidewalk Shed/Linear Feet`. The included GitHub Actions workflow refreshes it twice per week and commits the result, which works with free GitHub Pages hosting. NYC Planning GeoSearch remains the address matcher fallback; production use should still add caching and attribution.

Run `python3 scripts/validate-cache.py` after refreshing to check the snapshot schema, coordinates, duplicate jobs, linear footage, and the 325 West 15th/BIN 1013043 regression fixture.

