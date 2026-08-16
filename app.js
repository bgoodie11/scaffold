const map = L.map('map', { zoomControl: false }).setView([40.735, -73.99], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);

const routeForm = document.querySelector('#route-form');
const controlPanel = document.querySelector('.control-panel');
const button = document.querySelector('#route-button');
const locationButton = document.querySelector('#location-button');
const goButton = document.querySelector('#go-button');
const walkingIndicator = document.querySelector('#walking-indicator');
const stopWalkingButton = document.querySelector('#stop-walking-button');
const statusEl = document.querySelector('#status');
const resultsEl = document.querySelector('#route-results');
let routeLayers = [];
let scaffoldLayer = L.layerGroup().addTo(map);
let coverageLayers = L.layerGroup().addTo(map);
let currentOrigin = null;
let selectedRoute = null;
let navigationWatchId = null;
let navigationMarker = null;
let navigationAccuracy = null;
let navigationActive = false;
let currentOriginMarker = null;
let currentOriginAccuracy = null;
function resetControlPanelScroll() {
  if (!document.body.classList.contains('walking-mode')) controlPanel.scrollTop = 0;
}
window.addEventListener('pageshow', resetControlPanelScroll);
window.requestAnimationFrame(resetControlPanelScroll);
window.addEventListener('resize', () => map.invalidateSize());
setTimeout(() => map.invalidateSize(), 0);

const geocodeCache = new Map();
const selectedLocations = new WeakMap();
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
// We count a shed when the walking path comes close to its building footprint
// edge. This is a sidewalk-frontage proxy until we have exact shed polygons.
const SHED_MATCH_RADIUS_METERS = 42;
const setStatus = (message) => { statusEl.textContent = message; };
function clearCurrentOriginMarker() {
  if (currentOriginMarker) { map.removeLayer(currentOriginMarker); currentOriginMarker = null; }
  if (currentOriginAccuracy) { map.removeLayer(currentOriginAccuracy); currentOriginAccuracy = null; }
}

function showCurrentOrigin(position) {
  const point = [position.coords.latitude, position.coords.longitude];
  const accuracy = Math.round(position.coords.accuracy || 0);
  if (!currentOriginMarker) {
    currentOriginMarker = L.marker(point, { icon: L.divIcon({ className: 'current-location-pin', iconSize: [22, 22], iconAnchor: [11, 11] }) })
      .bindPopup('<b>Your current location</b><br><small>Used as the route start.</small>')
      .addTo(map);
  } else currentOriginMarker.setLatLng(point);
  if (!currentOriginAccuracy) currentOriginAccuracy = L.circle(point, { radius: accuracy, color: '#2878d0', weight: 1, opacity: .45, fillColor: '#2878d0', fillOpacity: .12 }).addTo(map);
  else { currentOriginAccuracy.setLatLng(point); currentOriginAccuracy.setRadius(accuracy); }
}
function setWalkingMode(active) {
  walkingIndicator.hidden = !active;
  document.body.classList.toggle('walking-mode', active);
  controlPanel.classList.toggle('walking-mode', active);
  map.getContainer().classList.toggle('walking-map', active);
}

function stopNavigation() {
  if (navigationWatchId !== null) navigator.geolocation?.clearWatch(navigationWatchId);
  navigationWatchId = null;
  navigationActive = false;
  setWalkingMode(false);
  goButton.textContent = 'Go on selected route';
  if (navigationMarker) { map.removeLayer(navigationMarker); navigationMarker = null; }
  if (navigationAccuracy) { map.removeLayer(navigationAccuracy); navigationAccuracy = null; }
}

function projectOntoRoute(point, route) {
  let best = { distance: Infinity, along: 0, point: null };
  let along = 0;
  const coordinates = route.geometry.coordinates;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const a = { lat: coordinates[index][1], lon: coordinates[index][0] };
    const b = { lat: coordinates[index + 1][1], lon: coordinates[index + 1][0] };
    const segment = nearestPointOnSegment(point, a, b);
    const length = distanceMeters(a, b);
    const fraction = length ? distanceMeters(a, segment.point) / length : 0;
    if (segment.distance < best.distance) best = { distance: segment.distance, along: along + length * fraction, point: segment.point };
    along += length;
  }
  return best;
}

function updateNavigationPosition(position) {
  if (!selectedRoute) return;
  const point = { lat: position.coords.latitude, lon: position.coords.longitude };
  const accuracy = Math.round(position.coords.accuracy || 0);
  const progress = projectOntoRoute(point, selectedRoute);
  const remaining = Math.max(0, selectedRoute.distance - progress.along);
  if (!navigationMarker) navigationMarker = L.circleMarker([point.lat, point.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2878d0', fillOpacity: 1 }).addTo(map);
  else navigationMarker.setLatLng([point.lat, point.lon]);
  if (!navigationAccuracy) navigationAccuracy = L.circle([point.lat, point.lon], { radius: accuracy, color: '#2878d0', weight: 1, opacity: .45, fillColor: '#2878d0', fillOpacity: .12 }).addTo(map);
  else { navigationAccuracy.setLatLng([point.lat, point.lon]); navigationAccuracy.setRadius(accuracy); }
  if (navigationActive) map.panTo([point.lat, point.lon], { animate: true, duration: .25 });
  if (remaining < 30 || progress.distance < 18 && remaining < 60) {
    setStatus('You’re at the destination.');
    goButton.textContent = 'Arrived';
    if (navigationWatchId !== null) navigator.geolocation?.clearWatch(navigationWatchId);
    navigationWatchId = null;
    navigationActive = false;
    setWalkingMode(false);
    return;
  }
  setStatus(`${Math.round(remaining)} m remaining · GPS accuracy ±${accuracy} m`);
}

function startNavigation() {
  if (!selectedRoute) return;
  if (!navigator.geolocation) { setStatus('This device does not provide location services.'); return; }
  if (navigationActive) { stopNavigation(); setStatus('Walking mode paused.'); return; }
  navigationActive = true;
  setWalkingMode(true);
  goButton.textContent = 'Pause walking mode';
  setStatus('Waiting for your location…');
  const options = { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 };
  navigator.geolocation.getCurrentPosition(updateNavigationPosition, error => {
    navigationActive = false;
    setWalkingMode(false);
    goButton.textContent = 'Go on selected route';
    setStatus(error.code === 1 ? 'Location permission was denied. Enable it in your browser settings.' : 'Could not get your location. Try again outside or near a window.');
  }, options);
  navigationWatchId = navigator.geolocation.watchPosition(updateNavigationPosition, error => {
    if (error.code === 1) { navigationActive = false; setWalkingMode(false); setStatus('Location permission was denied.'); }
  }, options);
}

function locationErrorMessage(error) {
  if (error?.code === 1) return 'Location permission was denied. In macOS, enable Location Services for your browser in System Settings → Privacy & Security → Location Services, then reload this page.';
  if (error?.code === 2) return 'Your Mac could not determine a location. Check Wi-Fi/location services and try again near a window.';
  if (error?.code === 3) return 'Location lookup timed out. Try again, or check that this site is running on localhost or HTTPS.';
  return 'Could not get your location. Try again.';
}

function requestCurrentLocation(onSuccess, onError = null) {
  const fail = message => { setStatus(message); if (onError) onError(); };
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  if (!window.isSecureContext && !isLocalhost) {
    fail('Location requires HTTPS or http://localhost. Open the app through the local server in README.md.');
    return;
  }
  if (!navigator.geolocation) {
    fail('This browser does not provide location services.');
    return;
  }
  setStatus('Requesting your location… If no prompt appears, check browser and macOS Location Services permissions.');
  let finished = false;
  const timeout = window.setTimeout(() => {
    if (!finished) setStatus('Still waiting for location. Check the browser location icon or macOS Location Services permission.');
  }, 12000);
  navigator.geolocation.getCurrentPosition(position => {
    finished = true;
    window.clearTimeout(timeout);
    onSuccess(position);
  }, error => {
    finished = true;
    window.clearTimeout(timeout);
    setStatus(locationErrorMessage(error));
    if (onError) onError(error);
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}

locationButton.addEventListener('click', () => {
  setStatus('Location button clicked. Checking browser permission…');
  locationButton.disabled = true;
  locationButton.textContent = 'Locating…';
  requestCurrentLocation(position => {
    currentOrigin = { lat: position.coords.latitude, lon: position.coords.longitude, label: 'Current location' };
    showCurrentOrigin(position);
    document.querySelector('#origin').value = 'Current location';
    locationButton.disabled = false;
    locationButton.textContent = 'Location set';
    setStatus('Current location set as the route start.');
    map.setView([currentOrigin.lat, currentOrigin.lon], 16);
  }, error => {
    locationButton.disabled = false;
    locationButton.textContent = 'Use my current location';
  });
  window.setTimeout(() => {
    if (locationButton.disabled) {
      locationButton.disabled = false;
      locationButton.textContent = 'Use my current location';
    }
  }, 22000);
});
document.querySelector('#origin').addEventListener('input', event => {
  if (event.target.value !== 'Current location') { currentOrigin = null; clearCurrentOriginMarker(); }
});
goButton.addEventListener('click', startNavigation);
stopWalkingButton.addEventListener('click', () => {
  stopNavigation();
  setStatus('Walking mode stopped.');
});

function setupAutocomplete(input, suggestions) {
  let timer = null;
  let requestNumber = 0;
  input.addEventListener('input', () => {
    if (input.id === 'origin' && input.value !== 'Current location') currentOrigin = null;
    selectedLocations.delete(input);
    window.clearTimeout(timer);
    suggestions.hidden = true;
    const query = input.value.trim();
    if (query.length < 3 || query === 'Current location') return;
    timer = window.setTimeout(async () => {
      const requestId = ++requestNumber;
      try {
        // Ask both services for a wider candidate pool, then rank locally. Asking
        // for only six first means the provider's ranking can hide the closest POI.
        const params = new URLSearchParams({ size: '20', text: query, 'focus.point.lat': '40.735', 'focus.point.lon': '-73.99' });
        const photonParams = new URLSearchParams({ q: `${query}, New York, NY`, limit: '30', lat: '40.735', lon: '-73.99', bbox: '-74.26,40.49,-73.70,40.92' });
        const [data, photonData] = await Promise.all([
          fetchJson(`https://geosearch.planninglabs.nyc/v2/autocomplete?${params}`, 'NYC place search').catch(() => ({ features: [] })),
          fetchJson(`https://photon.komoot.io/api/?${photonParams}`, 'OpenStreetMap place search').catch(() => ({ features: [] }))
        ]);
        if (requestId !== requestNumber || input.value.trim() !== query) return;
        const photonFeatures = (photonData.features || []).map(feature => {
          const properties = feature.properties || {};
          const address = [properties.housenumber, properties.street, properties.city || properties.locality, properties.state].filter(Boolean).join(', ');
          return { ...feature, properties: { ...properties, name: properties.name || address, label: address || properties.name } };
        });
        const geosearchFeatures = (data.features || []).filter(feature => /new york|ny,|manhattan|brooklyn|queens|bronx|staten island/i.test(feature.properties?.label || ''));
        const features = [...photonFeatures, ...geosearchFeatures].filter((feature, index, all) => {
          const label = feature.properties?.label || feature.properties?.name || '';
          return label && all.findIndex(candidate => (candidate.properties?.label || candidate.properties?.name || '') === label) === index;
        });
        const searchCenter = currentOrigin || map.getCenter();
        const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
        const featureDistance = feature => {
          const coordinates = feature.geometry?.coordinates;
          if (!Array.isArray(coordinates) || coordinates.length < 2) return Infinity;
          return distanceMeters(
            { lat: Number(coordinates[1]), lon: Number(coordinates[0]) },
            { lat: Number(searchCenter.lat), lon: Number(searchCenter.lng ?? searchCenter.lon) }
          );
        };
        const featureScore = feature => {
          const properties = feature.properties || {};
          const name = String(properties.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
          const tokenMatches = queryTokens.filter(token => name.includes(token)).length;
          const exactName = name === normalizedQuery ? 0 : name.startsWith(normalizedQuery) ? 1 : tokenMatches === queryTokens.length ? 2 : 3;
          return [exactName, -tokenMatches, featureDistance(feature)];
        };
        features.sort((a, b) => {
          const aScore = featureScore(a);
          const bScore = featureScore(b);
          for (let index = 0; index < aScore.length; index += 1) {
            if (aScore[index] !== bScore[index]) return aScore[index] - bScore[index];
          }
          return 0;
        });
        const rankedFeatures = features.slice(0, 6);
        if (!rankedFeatures.length) return;
        suggestions.innerHTML = rankedFeatures.map((feature, index) => {
          const label = feature.properties?.label || feature.properties?.name || query;
          const name = feature.properties?.name || label;
          const detail = name !== label ? label : '';
          const distance = featureDistance(feature);
          const distanceLabel = Number.isFinite(distance) ? `${distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1609.34).toFixed(1)} mi`} away` : '';
          return `<button class="suggestion" type="button" data-index="${index}" role="option"><b>${name}</b>${detail ? `<small>${detail}</small>` : ''}${distanceLabel ? `<small>${distanceLabel}</small>` : ''}</button>`;
        }).join('');
        suggestions.hidden = false;
        suggestions.querySelectorAll('.suggestion').forEach((option, index) => option.addEventListener('click', () => {
          const feature = rankedFeatures[index];
          const [lon, lat] = feature.geometry.coordinates;
          const label = feature.properties?.label || feature.properties?.name || query;
          input.value = label;
          selectedLocations.set(input, { lat: Number(lat), lon: Number(lon), label });
          suggestions.hidden = true;
        }));
      } catch (_) { suggestions.hidden = true; }
    }, 280);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') suggestions.hidden = true;
  });
}

setupAutocomplete(document.querySelector('#origin'), document.querySelector('#origin-suggestions'));
setupAutocomplete(document.querySelector('#destination'), document.querySelector('#destination-suggestions'));

async function fetchJson(url, service, options = {}) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`${service} returned HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`Could not reach ${service}. If you opened index.html directly, run the local server from README.md first.`);
    throw error;
  }
}

async function geocode(query) {
  if (geocodeCache.has(query)) return geocodeCache.get(query);
  const url = `https://geosearch.planninglabs.nyc/v2/search?size=1&text=${encodeURIComponent(query)}`;
  const places = await fetchJson(url, 'NYC address search', { headers: { Accept: 'application/json' } });
  const feature = places.features?.[0];
  if (!feature) throw new Error(`Could not find “${query}”.`);
  const [lon, lat] = feature.geometry.coordinates;
  const point = { lat: Number(lat), lon: Number(lon), label: feature.properties?.label || query };
  geocodeCache.set(query, point);
  return point;
}

async function getRoutes(start, end, via = null) {
  const points = [start, ...(via ? [via] : []), end];
  const coords = points.map(point => `${point.lon},${point.lat}`).join(';');
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&alternatives=${via ? 'false' : 'true'}`;
  const data = await fetchJson(url, 'OpenStreetMap walking router');
  if (!data.routes?.length) throw new Error('No walking route found.');
  return data.routes;
}

function pointAtRouteMidpoint(route) {
  const coordinates = route.geometry.coordinates;
  const index = Math.max(1, Math.floor(coordinates.length / 2));
  const previous = coordinates[index - 1];
  const current = coordinates[index];
  return { lat: current[1], lon: current[0], tangent: { x: current[0] - previous[0], y: current[1] - previous[1] } };
}

function offsetWaypoint(midpoint, tangent, meters) {
  const length = Math.hypot(tangent.x, tangent.y) || 1;
  const normal = { x: -tangent.y / length, y: tangent.x / length };
  const scale = 111320;
  const cosLat = Math.cos(midpoint.lat * Math.PI / 180);
  return {
    lat: midpoint.lat + normal.y * meters / scale,
    lon: midpoint.lon + normal.x * meters / (scale * cosLat)
  };
}

async function getParallelCandidates(start, end, baseRoute) {
  const midpoint = pointAtRouteMidpoint(baseRoute);
  const candidates = [];
  // Roughly one and two Manhattan blocks on either side of the baseline.
  for (const distance of [85, 170]) {
    for (const direction of [-1, 1]) {
      const via = offsetWaypoint(midpoint, midpoint.tangent, distance * direction);
      await wait(1100); // Respect the public routing server's one-request-per-second policy.
      try {
        const routes = await getRoutes(start, end, via);
        if (routes[0]) candidates.push(routes[0]);
      } catch (_) { /* A forced waypoint may be inaccessible; retain other candidates. */ }
    }
  }
  return candidates;
}

async function getScaffolds() {
  const params = new URLSearchParams({
    '$select': 'borough,bin__,house__,street_name,zip_code,permit_status,filing_status,permit_subtype',
    '$limit': '5000'
  });
  const rows = await fetchJson(`https://data.cityofnewyork.us/resource/29du-2wzn.json?${params}`, 'NYC scaffold data');
  // Filing status "Completed" means DOB finished processing the filing; it does
  // not mean the scaffold has been removed. Only exclude explicit end states.
  const closedTerms = /expired|withdrawn|cancelled|canceled|closed|revoked/i;
  return rows.filter(row => {
    const subtype = String(row.permit_subtype || '').trim().toUpperCase();
    const borough = String(row.borough || '').toLowerCase();
    const isManhattan = borough === '1' || borough === 'manhattan';
    return isManhattan && subtype === 'SH' && !closedTerms.test(`${row.permit_status || ''} ${row.filing_status || ''}`);
  });
}

async function getCachedScaffolds() {
  const response = await fetch('data/scaffolds.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('No local scaffold snapshot found.');
  const payload = await response.json();
  if (!Array.isArray(payload.rows)) throw new Error('Local scaffold snapshot is invalid.');
  if (payload.rows.length === 0) throw new Error('Local scaffold snapshot is empty.');
  const closedTerms = /expired|withdrawn|cancelled|canceled|closed|revoked/i;
  const rows = payload.rows.filter(row => {
    const subtype = String(row.permit_subtype || '').trim().toUpperCase();
    const borough = String(row.borough || '').toLowerCase();
    return subtype === 'SH' && (borough === '1' || borough === 'manhattan') && !closedTerms.test(`${row.permit_status || ''} ${row.filing_status || ''}`);
  });
  if (rows.length === 0) throw new Error('Local sidewalk-shed snapshot has no Manhattan records.');
  return { rows, updatedAt: payload.updatedAt || null };
}

async function getKnownObservations() {
  const response = await fetch('data/known-observations.json', { cache: 'no-store' });
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload.observations) ? payload.observations : [];
}

function routePoints(route) { return route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })); }
function distanceMeters(a, b) { const dLat = (a.lat - b.lat) * 111320; const dLon = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180); return Math.hypot(dLat, dLon); }
function nearestDistance(point, points) { return Math.min(...points.map(candidate => distanceMeters(point, candidate))); }
function normalizeStreetName(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(AVENUE|AVE|AV)\b/g, 'AVE')
    .replace(/\b(STREET|ST)\b/g, 'ST')
    .replace(/\b(WEST|W)\b/g, 'W')
    .replace(/\b(EAST|E)\b/g, 'E')
    .replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

function nearestPointOnSegment(point, a, b) {
  const scale = 111320;
  const cosLat = Math.cos(point.lat * Math.PI / 180);
  const px = (point.lon - a.lon) * scale * cosLat;
  const py = (point.lat - a.lat) * scale;
  const bx = (b.lon - a.lon) * scale * cosLat;
  const by = (b.lat - a.lat) * scale;
  const lengthSquared = bx * bx + by * by;
  const t = lengthSquared ? Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared)) : 0;
  const projected = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
  return { point: projected, distance: Math.hypot(px - t * bx, py - t * by) };
}

function footprintToRouteDistance(geometry, routePointsForSearch) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  let minimum = Infinity;
  let frontagePoint = null;
  polygons.flat().forEach(ring => {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const a = { lat: ring[index][1], lon: ring[index][0] };
      const b = { lat: ring[index + 1][1], lon: ring[index + 1][0] };
      routePointsForSearch.forEach(point => {
        const result = nearestPointOnSegment(point, a, b);
        if (result.distance < minimum) { minimum = result.distance; frontagePoint = result.point; }
      });
    }
  });
  return { distance: minimum, point: frontagePoint };
}

function footprintToPointDistance(geometry, point) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  let minimum = Infinity;
  polygons.flat().forEach(ring => {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const a = { lat: ring[index][1], lon: ring[index][0] };
      const b = { lat: ring[index + 1][1], lon: ring[index + 1][0] };
      minimum = Math.min(minimum, nearestPointOnSegment(point, a, b).distance);
    }
  });
  return minimum;
}

async function getBuildingFootprints(rows) {
  const bins = [...new Set(rows.map(row => String(row.bin__ || '').trim()).filter(bin => /^\d+$/.test(bin)))].slice(0, 100);
  if (!bins.length) return new Map();
  const params = new URLSearchParams({
    where: `BIN IN (${bins.join(',')})`,
    outFields: 'BIN',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson'
  });
  const data = await fetchJson(`https://services2.arcgis.com/IsDCghZ73NgoYoz5/ArcGIS/rest/services/NYC_Building_Footprint/FeatureServer/0/query?${params}`, 'NYC building footprints');
  return new Map((data.features || []).map(feature => [String(feature.properties?.BIN), feature.geometry]));
}

async function getNearbyBuildingBins(routePointsForSearch) {
  if (!routePointsForSearch.length) return new Set();
  const lats = routePointsForSearch.map(point => point.lat);
  const lons = routePointsForSearch.map(point => point.lon);
  const buffer = 0.0006; // roughly 50–70 m around the walking line's bounding box
  const geometry = JSON.stringify({
    xmin: Math.min(...lons) - buffer,
    ymin: Math.min(...lats) - buffer,
    xmax: Math.max(...lons) + buffer,
    ymax: Math.max(...lats) + buffer,
    spatialReference: { wkid: 4326 }
  });
  const params = new URLSearchParams({
    where: '1=1', geometry, geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: 'BIN', returnGeometry: 'false',
    resultRecordCount: '2000', f: 'json'
  });
  const data = await fetchJson(`https://services2.arcgis.com/IsDCghZ73NgoYoz5/ArcGIS/rest/services/NYC_Building_Footprint/FeatureServer/0/query?${params}`, 'NYC nearby building search');
  return new Set((data.features || []).map(feature => String(feature.attributes?.BIN || '').trim()).filter(Boolean));
}

async function mapScaffolds(rows, routePointsForSearch, routeStreetNames = []) {
  scaffoldLayer.clearLayers();
  const unique = new Map();
  rows.forEach(row => unique.set(`${row.house__ || ''} ${row.street_name || ''}`, row));
  const allCandidates = [...unique.values()].filter(row => row.house__ && row.street_name);
  const routeStreets = new Set(routeStreetNames.map(normalizeStreetName).filter(Boolean));
  const matchingCandidates = allCandidates.filter(row => routeStreets.has(normalizeStreetName(row.street_name)));
  let nearbyBins = new Set();
  try { nearbyBins = await getNearbyBuildingBins(routePointsForSearch); } catch (_) { /* Street matching remains available if the spatial service is unavailable. */ }
  const binCandidates = allCandidates.filter(row => nearbyBins.has(String(row.bin__ || '').trim()));
  const candidateMap = new Map([...matchingCandidates, ...binCandidates].map(row => [`${row.house__ || ''} ${row.street_name || ''} ${row.bin__ || ''}`, row]));
  // BIN-first: a permit filed at one address can cover another frontage of the
  // same building. Keep enough records for long sheds, but bound geocoding work.
  const candidates = [...candidateMap.values()].slice(0, 200);
  let footprints = new Map();
  try { footprints = await getBuildingFootprints(candidates); } catch (_) { /* Address proxy remains available if footprint service is unavailable. */ }
  let plotted = 0;
  const points = [];
  for (let index = 0; index < candidates.length; index += 10) {
    const batch = candidates.slice(index, index + 10);
    const results = await Promise.all(batch.map(async row => {
      const address = `${row.house__} ${row.street_name}, Manhattan, NY ${row.zip_code || ''}`;
      try {
        const directPoint = row.latitude && row.longitude ? { lat: Number(row.latitude), lon: Number(row.longitude) } : await geocode(address);
        return { row, address, point: directPoint };
      }
      catch (_) { return null; }
    }));
    results.filter(Boolean).forEach(({ row, address, point }) => {
      const footprint = footprints.get(String(row.bin__ || '').trim());
      const frontage = footprint ? footprintToRouteDistance(footprint, routePointsForSearch) : { distance: nearestDistance(point, routePointsForSearch), point };
      if (frontage.distance > SHED_MATCH_RADIUS_METERS) return;
      const mapPoint = frontage.point || point;
      L.marker([mapPoint.lat, mapPoint.lon], { icon: L.divIcon({ className: 'scaffold-dot', iconSize: [13, 13] }) })
        .bindPopup(`<b>Active sidewalk shed</b><br>${address}<br><small>${row.linear_feet ? `${Number(row.linear_feet).toLocaleString()} linear feet reported` : 'Linear footage unavailable'}<br>Building-frontage proxy: ${Math.round(frontage.distance)} m from route</small>`)
        .addTo(scaffoldLayer);
      // The active-shed CSV coordinate is often a permit/building centroid or
      // roadway-side point. Use the nearest building-footprint edge as the
      // visual side anchor so coverage is drawn on the sidewalk frontage.
      points.push({ ...(frontage.point || point), sidePoint: frontage.point || point, geometry: footprint || null, linearFeet: Number(row.linear_feet) || 0, confidence: 'permit' });
      plotted++;
    });
  }
  return { plotted, points };
}

function routeKey(route) {
  const coordinates = route.geometry?.coordinates || [];
  const stride = Math.max(1, Math.floor(coordinates.length / 10));
  return coordinates.filter((_, index) => index % stride === 0)
    .map(([lon, lat]) => `${lon.toFixed(4)},${lat.toFixed(4)}`).join(';');
}

function mapKnownObservations(observations, routePointsForSearch) {
  const points = [];
  observations.forEach(observation => {
    const point = { lat: Number(observation.lat), lon: Number(observation.lon) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || nearestDistance(point, routePointsForSearch) > 700) return;
    L.marker([point.lat, point.lon], { icon: L.divIcon({ className: 'reported-shed-dot', iconSize: [15, 15] }) })
      .bindPopup(`<b>Sidewalk shed frontage</b><br>${observation.label}<br><small>${observation.address}<br>Related permit: ${observation.relatedPermitAddress || 'not found'} (${observation.relatedPermitSubtype || 'reported'})<br>${observation.note}</small>`)
      .addTo(scaffoldLayer);
    points.push({ ...point, sidePoint: point, geometry: null, linearFeet: 0, confidence: 'reported' });
  });
  return points;
}

function scoreRoute(route, scaffoldPoints, preference) {
  const nearScaffolding = scaffoldPoints.filter(point => nearestDistance(point, routePoints(route)) < SHED_MATCH_RADIUS_METERS).length;
  const distanceKm = route.distance / 1000;
  const coveredPercent = routeCoverage(route, scaffoldPoints).coveredPercent;
  // Keep alternatives within roughly 12% of the shortest route; then optimize
  // estimated covered distance, with a small marker-count tie-breaker.
  const coverageScore = preference === 'min' ? coveredPercent * 35 : -coveredPercent * 35;
  const exposurePenalty = preference === 'min' ? nearScaffolding * 20 : -nearScaffolding * 10;
  return coverageScore + exposurePenalty + distanceKm * 100;
}

function routeEvidencePositions(route, shedPoints) {
  const coordinates = route.geometry.coordinates;
  return shedPoints.map(point => {
    let bestDistance = Infinity;
    let bestAlong = 0;
    let along = 0;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const a = { lat: coordinates[index][1], lon: coordinates[index][0] };
      const b = { lat: coordinates[index + 1][1], lon: coordinates[index + 1][0] };
      const segmentMeters = distanceMeters(a, b);
      const midpoint = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
      const candidateDistance = distanceMeters(midpoint, point);
      if (candidateDistance < bestDistance) { bestDistance = candidateDistance; bestAlong = along + segmentMeters / 2; }
      along += segmentMeters;
    }
    return { point, distance: bestDistance, along: bestAlong, length: Math.min(Number(point.linearFeet || 0) * 0.3048, 1000) };
  });
}

function offsetTowardSide(a, b, sidePoint, meters = 11) {
  if (!sidePoint) return [[a.lat, a.lon], [b.lat, b.lon]];
  const midpoint = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
  const scale = 111320;
  const cosLat = Math.cos(midpoint.lat * Math.PI / 180);
  const dx = (b.lon - a.lon) * scale * cosLat;
  const dy = (b.lat - a.lat) * scale;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const side = { x: (sidePoint.lon - midpoint.lon) * scale * cosLat, y: (sidePoint.lat - midpoint.lat) * scale };
  const sign = (side.x * normal.x + side.y * normal.y) >= 0 ? 1 : -1;
  const offset = { x: normal.x * sign * meters, y: normal.y * sign * meters };
  const move = point => [point.lat + offset.y / scale, point.lon + offset.x / (scale * cosLat)];
  return [move(a), move(b)];
}

function routeCoverage(route, shedPoints) {
  const coordinates = route.geometry.coordinates;
  let coveredMeters = 0;
  let totalMeters = 0;
  let distanceAlongRoute = 0;
  const evidencePositions = routeEvidencePositions(route, shedPoints);
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const a = { lat: coordinates[index][1], lon: coordinates[index][0] };
    const b = { lat: coordinates[index + 1][1], lon: coordinates[index + 1][0] };
    const segmentMeters = distanceMeters(a, b);
    const midpoint = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    totalMeters += segmentMeters;
    const midpointAlong = distanceAlongRoute + segmentMeters / 2;
    if (evidencePositions.some(evidence => {
      const nearFrontage = evidence.point.geometry ? footprintToPointDistance(evidence.point.geometry, midpoint) < SHED_MATCH_RADIUS_METERS : distanceMeters(midpoint, evidence.point) < SHED_MATCH_RADIUS_METERS;
      return evidence.distance < SHED_MATCH_RADIUS_METERS && (nearFrontage || (!evidence.point.geometry && evidence.length > 0 && Math.abs(midpointAlong - evidence.along) <= evidence.length / 2));
    })) coveredMeters += segmentMeters;
    distanceAlongRoute += segmentMeters;
  }
  const coveredPercent = totalMeters ? Math.round((coveredMeters / totalMeters) * 100) : 0;
  return { coveredPercent, uncoveredPercent: 100 - coveredPercent };
}

function drawCoverageLines(routes, shedPoints) {
  coverageLayers.clearLayers();
  routes.forEach(route => {
    const coordinates = route.geometry.coordinates;
    const evidencePositions = routeEvidencePositions(route, shedPoints);
    let along = 0;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const a = { lat: coordinates[index][1], lon: coordinates[index][0] };
      const b = { lat: coordinates[index + 1][1], lon: coordinates[index + 1][0] };
      const segmentMeters = distanceMeters(a, b);
      const midpoint = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
      const midpointAlong = along + segmentMeters / 2;
      const evidence = evidencePositions.find(candidate => {
        const nearFrontage = candidate.point.geometry ? footprintToPointDistance(candidate.point.geometry, midpoint) < SHED_MATCH_RADIUS_METERS : distanceMeters(midpoint, candidate.point) < SHED_MATCH_RADIUS_METERS;
        return candidate.distance < SHED_MATCH_RADIUS_METERS && (nearFrontage || (!candidate.point.geometry && candidate.length > 0 && Math.abs(midpointAlong - candidate.along) <= candidate.length / 2));
      });
      if (evidence) {
        const line = offsetTowardSide(a, b, evidence.point.sidePoint);
        const isReported = evidence.point.confidence === 'reported';
        L.polyline(line, { color: '#fffaf1', weight: 9, opacity: 0.92, lineCap: 'round', dashArray: isReported ? '5 7' : null }).addTo(coverageLayers);
        L.polyline(line, { color: '#e38b35', weight: 5, opacity: isReported ? 0.68 : 0.96, lineCap: 'round', dashArray: isReported ? '5 7' : null }).addTo(coverageLayers);
      }
      along += segmentMeters;
    }
  });
}

function showRoutes(routes, scored, preference) {
  routeLayers.forEach(layer => map.removeLayer(layer));
  coverageLayers.clearLayers();
  routeLayers = routes.map(route => L.geoJSON(route.geometry).addTo(map));
  const updateSelection = selected => {
    selectedRoute = routes[selected];
    goButton.hidden = false;
    routeLayers.forEach((layer, index) => layer.setStyle({ color: index === selected ? '#24683c' : '#9aafa0', weight: index === selected ? 7 : 4, opacity: index === selected ? 0.95 : 0.7 }));
    resultsEl.querySelectorAll('.route-card').forEach((card, index) => {
      card.classList.toggle('selected', index === selected);
      card.setAttribute('aria-pressed', index === selected ? 'true' : 'false');
    });
    setStatus(`${selected === scored.selected ? 'Recommended' : 'Selected alternative'} route: ${Math.round(routes[selected].distance)} m, ${Math.round(routes[selected].duration / 60)} min.`);
  };
  resultsEl.hidden = false;
  resultsEl.innerHTML = routes.map((route, index) => `<div class="route-card ${index === scored.selected ? 'selected' : ''}" role="button" tabindex="0" aria-pressed="${index === scored.selected ? 'true' : 'false'}" data-route-index="${index}"><strong>${index === scored.selected ? 'Recommended' : 'Alternative'} · ${route.distance < 1000 ? `${Math.round(route.distance)} m` : `${(route.distance / 1000).toFixed(1)} km`} · ${Math.round(route.duration / 60)} min</strong><span>${scored.coverage[index].coveredPercent}% estimated covered · ${scored.coverage[index].uncoveredPercent}% estimated uncovered</span><small>${preference === 'min' ? `${scored.exposures[index]} nearby sidewalk shed${scored.exposures[index] === 1 ? '' : 's'}` : `${scored.exposures[index]} nearby sidewalk shed${scored.exposures[index] === 1 ? '' : 's'} favored`}</small></div>`).join('');
  resultsEl.querySelectorAll('.route-card').forEach(card => {
    const select = () => updateSelection(Number(card.dataset.routeIndex));
    card.addEventListener('click', select);
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
  });
  drawCoverageLines(routes, scored.shedPoints);
  updateSelection(scored.selected);
}

routeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  stopNavigation();
  selectedRoute = null;
  goButton.hidden = true;
  button.disabled = true; resultsEl.hidden = true;
  try {
    if (window.location.protocol === 'file:') throw new Error('Please run this app through http://localhost:8000; browsers block its data services when index.html is opened directly.');
    const preference = new FormData(routeForm).get('preference');
    setStatus('Finding both places…');
    const originInput = document.querySelector('#origin');
    const destinationInput = document.querySelector('#destination');
    const originValue = originInput.value.trim();
    const destinationValue = destinationInput.value.trim();
    const selectedOrigin = selectedLocations.get(originInput);
    const selectedDestination = selectedLocations.get(destinationInput);
    const start = currentOrigin && originValue === 'Current location' ? currentOrigin : selectedOrigin?.label === originValue ? selectedOrigin : await geocode(originValue);
    const end = selectedDestination?.label === destinationValue ? selectedDestination : await geocode(destinationValue);
    setStatus('Calculating walking alternatives…');
    let routes = await getRoutes(start, end);
    const baseRoute = routes.reduce((shortestRoute, route) => route.distance < shortestRoute.distance ? route : shortestRoute, routes[0]);
    setStatus('Exploring nearby parallel streets…');
    const parallelRoutes = await getParallelCandidates(start, end, baseRoute);
    routes = [...new Map([...routes, ...parallelRoutes].map(route => [routeKey(route), route])).values()];
    const shortestDistance = Math.min(...routes.map(route => route.distance));
    routes = routes.filter(route => route.distance <= shortestDistance * 1.12);
    const allPoints = routes.flatMap(routePoints);
    const routeStreetNames = routes.flatMap(route => (route.legs || []).flatMap(leg => (leg.steps || []).map(step => step.name))).filter(Boolean);
    let permits = [];
    let scaffoldResult = { plotted: 0, points: [] };
    let scaffoldWarning = '';
    let scaffoldSource = 'local snapshot';
    setStatus('Loading cached NYC scaffold permits…');
    try {
      const cached = await getCachedScaffolds();
      permits = cached.rows;
      scaffoldResult = await mapScaffolds(permits, allPoints, routeStreetNames);
      if (cached.updatedAt) scaffoldSource += ` from ${new Date(cached.updatedAt).toLocaleDateString()}`;
    } catch (error) {
      scaffoldSource = 'live fallback';
      try {
        permits = await getScaffolds();
        scaffoldResult = await mapScaffolds(permits, allPoints, routeStreetNames);
      } catch (liveError) {
        scaffoldWarning = ` NYC scaffold data unavailable; showing the normal walking route.`;
      }
    }
    const scaffoldPoints = scaffoldResult.points;
    const knownObservations = await getKnownObservations();
    const observedPoints = mapKnownObservations(knownObservations, allPoints);
    const allShedPoints = [...scaffoldPoints, ...observedPoints];
    const shortest = Math.min(...routes.map(route => route.distance));
    const eligible = routes.map((route, index) => route.distance <= shortest * 1.12 ? index : -1).filter(index => index >= 0);
    const exposures = routes.map(route => allShedPoints.filter(point => nearestDistance(point, routePoints(route)) < SHED_MATCH_RADIUS_METERS).length);
    const coverage = routes.map(route => routeCoverage(route, allShedPoints));
    const selected = eligible.sort((a, b) => scoreRoute(routes[a], allShedPoints, preference) - scoreRoute(routes[b], allShedPoints, preference))[0] ?? 0;
    showRoutes(routes, { selected, exposures, coverage, shedPoints: allShedPoints }, preference);
    const bounds = L.featureGroup(routeLayers).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.12));
    setStatus(scaffoldWarning || `Loaded ${scaffoldResult.plotted} permit sheds and ${observedPoints.length} reported sheds from ${permits.length} filtered SH permits (${scaffoldSource}). Route ranking is approximate while permit geometry is being inferred.`);
  } catch (error) {
    setStatus(error.message || 'Something went wrong.');
  } finally { button.disabled = false; }
});
