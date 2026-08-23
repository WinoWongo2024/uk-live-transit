// UK Live Transit – powered by bustimes.org (no API key, no daily limit)

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

let map, userMarker;
let stopMarkers = [];
let vehicleMarkers = [];
let currentLat = null, currentLon = null;
let currentPlaces = [];
let selectedPlace = null;
let moveTimer = null;
let vehicleTimer = null;
let isLoading = false;

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
      loadFromMapBounds();
      loadVehicles();
    }, 700);
  });
}

function setUserLocation(lat, lon) {
  currentLat = lat;
  currentLon = lon;
  if (userMarker) map.removeLayer(userMarker);
  const icon = L.divIcon({
    className: "",
    html: '<div class="user-marker"></div>',
    iconSize: [16, 16], iconAnchor: [8, 8]
  });
  userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
  map.setView([lat, lon], 15);
}

function getBoundsParams() {
  const b = map.getBounds();
  // Keep bbox reasonably small so the server stays happy
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

// ---------- API helpers ----------
async function fetchJson(url) {
  const res = await fetch(url);
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
    const t = new Date(iso);
    return Math.round((t - new Date()) / 60000);
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
async function loadFromMapBounds(showStatus = false) {
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
      // URL is like /stops/010000002 → atcocode
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

    // Sort by distance if we have user location
    places.sort((a, b) => (a.distance || 99999) - (b.distance || 99999));

    currentPlaces = places;
    clearStopMarkers();
    places.slice(0, 80).forEach(addStopMarker); // don't overload the map
    renderStops(places.slice(0, 40));

    nearbyCount.textContent = places.length;
    if (places.length === 0) {
      statusEl.textContent = "No stops in this area. Zoom in or pan somewhere busier.";
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

  selectedStopName.textContent = place.name || "Departures";
  selectedStopMeta.textContent = (place.services || []).slice(0, 5).join(", ") || "Bus stop";
  updateFavButton(place);

  if (place.latitude && place.longitude) {
    map.setView([place.latitude, place.longitude], 16);
  }

  departuresList.innerHTML = `<div class="status"><span class="spinner"></span> Loading live times…</div>`;

  if (!place.atcocode) {
    departuresList.innerHTML = `<div class="error">No stop code available.</div>`;
    return;
  }

  try {
    const url = `https://bustimes.org/stops/${encodeURIComponent(place.atcocode)}/times.json`;
    const data = await fetchJson(url);
    renderDepartures(data.times || []);
  } catch (err) {
    console.error(err);
    departuresList.innerHTML = `<div class="error">Couldn’t load departures<br>${err.message}</div>`;
  }
}

function renderDepartures(times) {
  if (!times.length) {
    departuresList.innerHTML = `<div class="status">No departures right now.</div>`;
    return;
  }

  // Prefer expected time, fall back to aimed
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
}

// ---------- Favourites view ----------
function showFavourites() {
  nearbyView.classList.add("hidden");
  departuresView.classList.add("hidden");
  favouritesView.classList.remove("hidden");

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
function locate() {
  if (!navigator.geolocation) {
    statusEl.innerHTML = `<div class="error">Geolocation not supported</div>`;
    return;
  }

  statusEl.innerHTML = `<span class="spinner"></span> Getting your location…`;
  statusEl.classList.remove("hidden");
  nearbyView.classList.remove("hidden");
  departuresView.classList.add("hidden");
  favouritesView.classList.add("hidden");

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      setUserLocation(latitude, longitude);
      loadFromMapBounds(true);
      loadVehicles();
      // Refresh vehicles every 20s while on the map
      clearInterval(vehicleTimer);
      vehicleTimer = setInterval(loadVehicles, 20000);
    },
    err => {
      statusEl.innerHTML = `<div class="error">Location error: ${err.message}<br>Allow location and try again.</div>`;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 20000 }
  );
}

// ---------- Events ----------
$("locateBtn").addEventListener("click", locate);
$("favBtn").addEventListener("click", showFavourites);
$("backBtn").addEventListener("click", () => {
  departuresView.classList.add("hidden");
  nearbyView.classList.remove("hidden");
  if (currentLat && currentLon) map.setView([currentLat, currentLon], 15);
});
$("favBackBtn").addEventListener("click", () => {
  favouritesView.classList.add("hidden");
  nearbyView.classList.remove("hidden");
});
$("toggleFavBtn").addEventListener("click", () => {
  if (selectedPlace) toggleFavourite(selectedPlace);
});

// ---------- Init ----------
initMap();
setTimeout(locate, 300);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
