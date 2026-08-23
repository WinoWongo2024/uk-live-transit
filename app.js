// UK Live Transit – bustimes.org (no keys)
// Map/API never cached by SW. App shell can be.

const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const stopsList = $("stopsList");
const departuresList = $("departuresList");
const nearbyView = $("nearbyView");
const departuresView = $("departuresView");
const favouritesView = $("favouritesView");
const nearbyCount = $("nearbyCount");
const selectedStopName = $("selectedStopName");
const selectedStopMeta = $("selectedStopMeta");
const favouritesList = $("favouritesList");
const favEmpty = $("favEmpty");
const toggleFavBtn = $("toggleFavBtn");
const searchInput = $("searchInput");
const searchClear = $("searchClear");
const searchResults = $("searchResults");

let map, userMarker;
let stopMarkers = [];
let vehicleMarkers = [];
let currentLat = null, currentLon = null;
let currentPlaces = [];
let selectedPlace = null;
let moveTimer = null;
let vehicleTimer = null;
let searchTimer = null;
let isLoading = false;
let hasCenteredOnce = false; // only auto-zoom once

// ---------- Favourites ----------
const FAV_KEY = "uk-live-transit-favs";
function getFavourites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); }
  catch { return []; }
}
function saveFavourites(list) { localStorage.setItem(FAV_KEY, JSON.stringify(list)); }
function placeKey(p) { return p.atcocode || p.id || (p.name + (p.latitude || "")); }
function isFavourite(p) { return getFavourites().some(f => f.id === placeKey(p)); }

function toggleFavourite(place) {
  const list = getFavourites();
  const id = placeKey(place);
  const idx = list.findIndex(f => f.id === id);
  if (idx >= 0) list.splice(idx, 1);
  else list.push({
    id, name: place.name, atcocode: place.atcocode,
    latitude: place.latitude, longitude: place.longitude,
    services: place.services || []
  });
  saveFavourites(list);
  updateFavButton(place);
}

function updateFavButton(place) {
  if (!place) return;
  const fav = isFavourite(place);
  toggleFavBtn.textContent = fav ? "★" : "☆";
  toggleFavBtn.classList.toggle("active", fav);
}

// ---------- Map ----------
function initMap() {
  map = L.map("map", { zoomControl: false, attributionControl: false })
    .setView([53.8, -1.5], 7);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19, subdomains: "abcd"
  }).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  map.on("moveend", () => {
    if (isLoading) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      loadFromMapBounds(false);
      loadVehicles();
    }, 800);
  });
}

function setUserLocation(lat, lon, shouldZoom) {
  currentLat = lat;
  currentLon = lon;

  if (userMarker) map.removeLayer(userMarker);
  const icon = L.divIcon({
    className: "",
    html: '<div class="user-marker"></div>',
    iconSize: [16, 16], iconAnchor: [8, 8]
  });
  userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);

  // Only zoom when asked (first load or user taps locate)
  if (shouldZoom) {
    map.setView([lat, lon], 15);
    hasCenteredOnce = true;
  }
}

function getBoundsParams() {
  const b = map.getBounds();
  return {
    ymin: b.getSouth().toFixed(5),
    ymax: b.getNorth().toFixed(5),
    xmin: b.getWest().toFixed(5),
    xmax: b.getEast().toFixed(5)
  };
}

function clearStopMarkers() {
  stopMarkers.forEach(m => map.removeLayer(m));
  stopMarkers = [];
}
function clearVehicleMarkers() {
  vehicleMarkers.forEach(m => map.removeLayer(m));
  vehicleMarkers = [];
}

function addStopMarker(place) {
  if (!place.latitude || !place.longitude) return;
  const icon = L.divIcon({
    className: "",
    html: '<div class="stop-marker-bus"></div>',
    iconSize: [12, 12], iconAnchor: [6, 6]
  });
  const m = L.marker([place.latitude, place.longitude], { icon })
    .addTo(map)
    .on("click", () => showDepartures(place));
  stopMarkers.push(m);
}

function addVehicleMarker(v) {
  if (!v.coordinates || v.coordinates.length < 2) return;
  const [lon, lat] = v.coordinates;
  const line = v.service?.line_name || "?";
  const dest = v.destination || "";
  const name = v.vehicle?.name || "";

  const icon = L.divIcon({
    className: "",
    html: `<div style="
      background:#c026d3;color:#fff;font-size:10px;font-weight:700;
      padding:2px 5px;border-radius:6px;border:1.5px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);white-space:nowrap;
    ">${line}</div>`,
    iconSize: [30, 18], iconAnchor: [15, 9]
  });

  const m = L.marker([lat, lon], { icon, zIndexOffset: 500 })
    .addTo(map)
    .bindPopup(`<b>${line}</b> → ${dest}<br><small>${name}</small>`);
  vehicleMarkers.push(m);
}

// ---------- Helpers ----------
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDistance(m) {
  if (m == null) return "";
  if (m < 1000) return Math.round(m) + " m";
  return (m / 1000).toFixed(1) + " km";
}

function minutesUntil(iso) {
  if (!iso) return null;
  try {
    return Math.round((new Date(iso) - new Date()) / 60000);
  } catch { return null; }
}

function formatTimeLabel(iso) {
  const mins = minutesUntil(iso);
  if (mins == null) return { mins: "—", clock: "" };
  if (mins <= 0) return { mins: "Due", clock: "" };
  if (mins < 60) {
    const clock = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return { mins: mins + " min", clock };
  }
  return {
    mins: new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    clock: ""
  };
}

// ---------- Stops from map bounds ----------
async function loadFromMapBounds(showStatus) {
  if (isLoading) return;
  isLoading = true;

  if (showStatus) {
    statusEl.innerHTML = `<span class="spinner"></span> Finding stops…`;
    statusEl.classList.remove("hidden");
  }

  try {
    const p = getBoundsParams();
    const url = `https://bustimes.org/stops.json?ymin=${p.ymin}&ymax=${p.ymax}&xmin=${p.xmin}&xmax=${p.xmax}`;
    const data = await fetchJson(url);
    const features = data.features || [];

    const places = features.map(f => {
      const [lon, lat] = f.geometry.coordinates;
      const props = f.properties || {};
      const atco = (props.url || "").replace("/stops/", "") || null;
      let dist = null;
      if (currentLat != null) dist = haversine(currentLat, currentLon, lat, lon);
      return {
        name: props.name || "Bus stop",
        atcocode: atco,
        latitude: lat,
        longitude: lon,
        services: props.services || [],
        indicator: props.indicator,
        distance: dist
      };
    });

    places.sort((a, b) => (a.distance || 99999) - (b.distance || 99999));

    currentPlaces = places;
    clearStopMarkers();
    places.slice(0, 80).forEach(addStopMarker);
    renderStops(places.slice(0, 40));

    nearbyCount.textContent = places.length;
    if (places.length === 0) {
      statusEl.innerHTML = `No stops in this area.<br>Zoom in or search for a place.`;
      statusEl.classList.remove("hidden");
    } else {
      statusEl.classList.add("hidden");
    }
  } catch (err) {
    console.error(err);
    statusEl.innerHTML = `<div class="error">Couldn’t load stops<br>${err.message}</div>`;
    statusEl.classList.remove("hidden");
  } finally {
    isLoading = false;
  }
}

function renderStops(places) {
  stopsList.innerHTML = "";
  places.forEach(place => {
    const services = (place.services || []).slice(0, 4).join(", ");
    const card = document.createElement("div");
    card.className = "stop-card";
    card.innerHTML = `
      <div class="stop-icon bus">B</div>
      <div class="stop-info">
        <div class="name">${place.name}</div>
        <div class="sub">${services || "Bus stop"}${place.indicator ? " · " + place.indicator : ""}</div>
      </div>
      <div class="distance">${formatDistance(place.distance)}</div>
    `;
    card.addEventListener("click", () => showDepartures(place));
    stopsList.appendChild(card);
  });
}

// ---------- Live vehicles ----------
async function loadVehicles() {
  try {
    const p = getBoundsParams();
    const url = `https://bustimes.org/vehicles.json?ymin=${p.ymin}&ymax=${p.ymax}&xmin=${p.xmin}&xmax=${p.xmax}`;
    const data = await fetchJson(url);
    const list = Array.isArray(data) ? data : [];
    clearVehicleMarkers();
    list.slice(0, 120).forEach(addVehicleMarker);
  } catch (err) {
    console.warn("Vehicles load failed", err);
  }
}

// ---------- Departures ----------
async function showDepartures(place) {
  selectedPlace = place;
  nearbyView.classList.add("hidden");
  favouritesView.classList.add("hidden");
  departuresView.classList.remove("hidden");
  hideSearchResults();

  selectedStopName.textContent = place.name || "Departures";
  selectedStopMeta.textContent = (place.services || []).slice(0, 6).join(", ") || "Bus stop";
  updateFavButton(place);

  // Gentle fly to stop — only once when opening, user can pan freely after
  if (place.latitude && place.longitude) {
    map.panTo([place.latitude, place.longitude], { animate: true });
  }

  departuresList.innerHTML = `<div class="status"><span class="spinner"></span> Loading…</div>`;

  if (!place.atcocode) {
    showDeparturesFallback(place, "No stop code available.");
    return;
  }

  // times.json often has no CORS headers → browser blocks it.
  // Try it; on failure show a useful fallback.
  try {
    const url = `https://bustimes.org/stops/${encodeURIComponent(place.atcocode)}/times.json`;
    const data = await fetchJson(url);
    const times = data.times || (Array.isArray(data) ? data : []);
    if (!times.length) {
      showDeparturesFallback(place, null);
    } else {
      renderDepartures(times, place);
    }
  } catch (err) {
    console.warn("times.json failed (likely CORS)", err);
    showDeparturesFallback(place, null);
  }
}

function renderDepartures(times, place) {
  const sorted = [...times].sort((a, b) => {
    const ta = a.expected_departure_time || a.aimed_departure_time || "";
    const tb = b.expected_departure_time || b.aimed_departure_time || "";
    return ta.localeCompare(tb);
  });

  departuresList.innerHTML = "";
  sorted.slice(0, 25).forEach(t => {
    const line = t.service?.line_name || "?";
    const dest = t.destination?.name || t.destination?.locality || "";
    const expected = t.expected_departure_time || t.aimed_departure_time;
    const label = formatTimeLabel(expected);
    const live = !!t.expected_departure_time;

    const card = document.createElement("div");
    card.className = "departure-card";
    card.innerHTML = `
      <div class="line-badge">${line}</div>
      <div class="dest-block">
        <div class="dest">${dest}</div>
        <div class="extra">${live ? "Live" : "Scheduled"}</div>
      </div>
      <div class="time-block">
        <div class="mins">${label.mins}</div>
        ${label.clock ? `<div class="clock">${label.clock}</div>` : ""}
      </div>
    `;
    departuresList.appendChild(card);
  });

  appendBustimesLink(place);
}

function showDeparturesFallback(place, errMsg) {
  const services = place.services || [];
  let html = "";

  if (services.length) {
    html += `<div class="info-box"><strong>Services at this stop:</strong><br>${services.join(", ")}</div>`;
    services.slice(0, 12).forEach(line => {
      html += `
        <div class="departure-card">
          <div class="line-badge">${line}</div>
          <div class="dest-block">
            <div class="dest">Service ${line}</div>
            <div class="extra">See live times on bustimes.org</div>
          </div>
        </div>`;
    });
  } else {
    html += `<div class="info-box">
      No live departure times available here right now.<br><br>
      This can happen overnight, or if the operator isn’t publishing live data.<br><br>
      <strong>Tip:</strong> check your local operator app (First Bus, Stagecoach, Arriva, TfL Go, etc.) for the latest times.
    </div>`;
  }

  if (errMsg) {
    html = `<div class="error">${errMsg}</div>` + html;
  }

  departuresList.innerHTML = html;
  appendBustimesLink(place);
}

function appendBustimesLink(place) {
  if (!place.atcocode) return;
  const a = document.createElement("a");
  a.className = "ext-link";
  a.href = `https://bustimes.org/stops/${encodeURIComponent(place.atcocode)}`;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = "Open full live board on bustimes.org →";
  departuresList.appendChild(a);
}

// ---------- Search ----------
function hideSearchResults() {
  searchResults.classList.add("hidden");
  searchResults.innerHTML = "";
}

async function runSearch(q) {
  q = (q || "").trim();
  if (q.length < 2) {
    hideSearchResults();
    return;
  }

  searchResults.classList.remove("hidden");
  searchResults.innerHTML = `<div class="status"><span class="spinner"></span> Searching…</div>`;

  try {
    // API has CORS *
    const url = `https://bustimes.org/api/stops/?search=${encodeURIComponent(q)}&limit=12`;
    const data = await fetchJson(url);
    const results = data.results || [];

    if (!results.length) {
      searchResults.innerHTML = `<div class="status">No stops found for “${q}”</div>`;
      return;
    }

    searchResults.innerHTML = "";
    results.forEach(r => {
      const [lon, lat] = r.location || [null, null];
      const place = {
        name: r.name || r.common_name || r.long_name || "Stop",
        atcocode: r.atco_code,
        latitude: lat,
        longitude: lon,
        services: r.line_names || [],
        indicator: r.indicator
      };
      const card = document.createElement("div");
      card.className = "stop-card";
      card.innerHTML = `
        <div class="stop-icon bus">B</div>
        <div class="stop-info">
          <div class="name">${place.name}</div>
          <div class="sub">${(place.services || []).slice(0, 4).join(", ") || place.atcocode || ""}</div>
        </div>
      `;
      card.addEventListener("click", () => {
        hideSearchResults();
        searchInput.value = "";
        searchClear.classList.add("hidden");
        if (lat != null && lon != null) {
          map.setView([lat, lon], 16);
        }
        showDepartures(place);
      });
      searchResults.appendChild(card);
    });
  } catch (err) {
    searchResults.innerHTML = `<div class="error">Search failed<br>${err.message}</div>`;
  }
}

// ---------- Favourites ----------
function showFavourites() {
  nearbyView.classList.add("hidden");
  departuresView.classList.add("hidden");
  favouritesView.classList.remove("hidden");
  hideSearchResults();

  const favs = getFavourites();
  favouritesList.innerHTML = "";

  if (!favs.length) {
    favEmpty.classList.remove("hidden");
    return;
  }
  favEmpty.classList.add("hidden");

  favs.forEach(f => {
    const card = document.createElement("div");
    card.className = "stop-card";
    card.innerHTML = `
      <div class="stop-icon bus">B</div>
      <div class="stop-info">
        <div class="name">${f.name}</div>
        <div class="sub">${(f.services || []).slice(0, 4).join(", ") || "Favourite"}</div>
      </div>
    `;
    card.addEventListener("click", () => showDepartures(f));
    favouritesList.appendChild(card);
  });
}

// ---------- Location ----------
function locate(forceZoom) {
  if (!navigator.geolocation) {
    statusEl.innerHTML = `<div class="error">Geolocation not supported</div>`;
    return;
  }

  statusEl.innerHTML = `<span class="spinner"></span> Getting your location…`;
  statusEl.classList.remove("hidden");
  nearbyView.classList.remove("hidden");
  departuresView.classList.add("hidden");
  favouritesView.classList.add("hidden");
  hideSearchResults();

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      const zoom = forceZoom || !hasCenteredOnce;
      setUserLocation(latitude, longitude, zoom);
      loadFromMapBounds(true);
      loadVehicles();
      clearInterval(vehicleTimer);
      vehicleTimer = setInterval(loadVehicles, 25000);
    },
    err => {
      statusEl.innerHTML = `<div class="error">Location error: ${err.message}<br>Allow location and try again, or use search.</div>`;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

// ---------- Events ----------
$("locateBtn").addEventListener("click", () => locate(true)); // user asked → zoom
$("favBtn").addEventListener("click", showFavourites);

$("backBtn").addEventListener("click", () => {
  departuresView.classList.add("hidden");
  nearbyView.classList.remove("hidden");
  // Do NOT re-zoom to user — leave the map where it is
});

$("favBackBtn").addEventListener("click", () => {
  favouritesView.classList.add("hidden");
  nearbyView.classList.remove("hidden");
});

$("toggleFavBtn").addEventListener("click", () => {
  if (selectedPlace) toggleFavourite(selectedPlace);
});

searchInput.addEventListener("input", () => {
  const q = searchInput.value;
  searchClear.classList.toggle("hidden", !q);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(q), 350);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runSearch(searchInput.value);
  }
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchClear.classList.add("hidden");
  hideSearchResults();
  searchInput.focus();
});

// Close search when tapping map
document.getElementById("map").addEventListener("click", hideSearchResults);

// ---------- Init ----------
initMap();
// First load: locate + zoom once only
setTimeout(() => locate(false), 300);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
