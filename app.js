// UK Live Transit – map-first, First Bus style

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
let currentLat = null, currentLon = null;
let currentPlaces = [];
let selectedPlace = null;
let moveTimer = null;
let isLoading = false;

// ---------- Favourites (localStorage) ----------
const FAV_KEY = "uk-live-transit-favs";

function getFavourites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveFavourites(list) {
  localStorage.setItem(FAV_KEY, JSON.stringify(list));
}

function isFavourite(place) {
  const id = placeKey(place);
  return getFavourites().some((f) => f.id === id);
}

function placeKey(place) {
  return place.atcocode || place.station_code || place.name + (place.latitude || "");
}

function toggleFavourite(place) {
  const list = getFavourites();
  const id = placeKey(place);
  const idx = list.findIndex((f) => f.id === id);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.push({
      id,
      name: place.name,
      type: place.type,
      atcocode: place.atcocode,
      station_code: place.station_code,
      latitude: place.latitude,
      longitude: place.longitude,
      accuracy: place.accuracy
    });
  }
  saveFavourites(list);
  updateFavButton(place);
}

function updateFavButton(place) {
  if (!place) return;
  toggleFavBtn.textContent = isFavourite(place) ? "★" : "☆";
  toggleFavBtn.classList.toggle("active", isFavourite(place));
}

// ---------- Map ----------
function initMap() {
  map = L.map("map", {
    zoomControl: false,
    attributionControl: false
  }).setView([53.8, -1.5], 7); // UK centre-ish

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd"
  }).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  // When user moves the map, reload nearby stops (debounced)
  map.on("moveend", () => {
    if (isLoading) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const c = map.getCenter();
      // Only fetch if we moved a meaningful distance or zoomed
      loadNearby(c.lat, c.lng, false);
    }, 600);
  });
}

function setUserLocation(lat, lon) {
  currentLat = lat;
  currentLon = lon;

  if (userMarker) map.removeLayer(userMarker);

  const icon = L.divIcon({
    className: "",
    html: '<div class="user-marker"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
  map.setView([lat, lon], 15);
}

function clearStopMarkers() {
  stopMarkers.forEach((m) => map.removeLayer(m));
  stopMarkers = [];
}

function addStopMarker(place) {
  if (!place.latitude || !place.longitude) return;
  const isTrain = isTrainPlace(place);
  const icon = L.divIcon({
    className: "",
    html: `<div class="${isTrain ? "stop-marker-train" : "stop-marker-bus"}"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
  const m = L.marker([place.latitude, place.longitude], { icon })
    .addTo(map)
    .on("click", () => showDepartures(place));
  stopMarkers.push(m);
}

// ---------- Helpers ----------
function hasKeys() {
  return CONFIG.TRANSPORTAPI_APP_ID && CONFIG.TRANSPORTAPI_APP_KEY;
}

function apiUrl(path, params = {}) {
  const url = new URL("https://transportapi.com/v3/uk" + path);
  url.searchParams.set("app_id", CONFIG.TRANSPORTAPI_APP_ID);
  url.searchParams.set("app_key", CONFIG.TRANSPORTAPI_APP_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 100)}`);
  }
  return res.json();
}

function isTrainPlace(place) {
  return (
    (place.type || "").toLowerCase().includes("train") ||
    !!place.station_code ||
    (place.type || "").toLowerCase().includes("rail")
  );
}

function formatDistance(m) {
  if (m == null) return "";
  if (m < 1000) return Math.round(m) + " m";
  return (m / 1000).toFixed(1) + " km";
}

function minutesUntil(timeStr) {
  if (!timeStr) return null;
  try {
    let t;
    if (timeStr.length <= 5) {
      // HH:MM
      const [h, m] = timeStr.split(":").map(Number);
      t = new Date();
      t.setHours(h, m, 0, 0);
      if (t < new Date()) t.setDate(t.getDate() + 1);
    } else {
      t = new Date(timeStr);
    }
    const diff = Math.round((t - new Date()) / 60000);
    return diff;
  } catch {
    return null;
  }
}

function formatTimeLabel(timeStr) {
  const mins = minutesUntil(timeStr);
  if (mins == null) return { mins: "—", clock: "" };
  if (mins <= 0) return { mins: "Due", clock: "" };
  if (mins < 60) return { mins: mins + " min", clock: timeStr?.slice(0, 5) || "" };
  return { mins: timeStr?.slice(0, 5) || "—", clock: "" };
}

// ---------- Nearby stops ----------
async function loadNearby(lat, lon, showStatus = true) {
  if (!hasKeys()) {
    statusEl.innerHTML = `<div class="error">Add your TransportAPI keys in config.js<br>
      <a href="https://developer.transportapi.com/" target="_blank" style="color:#22d3ee">Get free keys</a></div>`;
    return;
  }

  if (isLoading) return;
  isLoading = true;

  if (showStatus) {
    statusEl.innerHTML = `<span class="spinner"></span> Finding stops around you…`;
    statusEl.classList.remove("hidden");
  }

  try {
    const url = apiUrl("/places.json", {
      lat: lat.toFixed(5),
      lon: lon.toFixed(5),
      type: "bus_stop,train_station",
      rpp: 25
    });
    const data = await fetchJson(url);
    const places = (data.member || []).sort(
      (a, b) => (a.distance || 9999) - (b.distance || 9999)
    );

    currentPlaces = places;
    clearStopMarkers();
    places.forEach(addStopMarker);
    renderStops(places);

    nearbyCount.textContent = places.length;
    if (places.length === 0) {
      statusEl.textContent = "No stops found here. Pan the map or try another area.";
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
  places.forEach((place) => {
    const train = isTrainPlace(place);
    const card = document.createElement("div");
    card.className = "stop-card";
    card.innerHTML = `
      <div class="stop-icon ${train ? "train" : "bus"}">${train ? "T" : "B"}</div>
      <div class="stop-info">
        <div class="name">${place.name || "Stop"}</div>
        <div class="sub">${train ? "Train station" : "Bus stop"}${place.accuracy ? " · " + place.accuracy : ""}</div>
      </div>
      <div class="distance">${formatDistance(place.distance)}</div>
    `;
    card.addEventListener("click", () => showDepartures(place));
    stopsList.appendChild(card);
  });
}

// ---------- Departures ----------
async function showDepartures(place) {
  selectedPlace = place;
  nearbyView.classList.add("hidden");
  favouritesView.classList.add("hidden");
  departuresView.classList.remove("hidden");

  selectedStopName.textContent = place.name || "Departures";
  selectedStopMeta.textContent = isTrainPlace(place) ? "Train station" : "Bus stop";
  updateFavButton(place);

  if (place.latitude && place.longitude) {
    map.setView([place.latitude, place.longitude], 16);
  }

  departuresList.innerHTML = `<div class="status"><span class="spinner"></span> Loading live times…</div>`;

  try {
    if (isTrainPlace(place) && place.station_code) {
      const url = apiUrl(`/train/station/${place.station_code}/live.json`, {
        darwin: "true",
        train_status: "passenger"
      });
      const data = await fetchJson(url);
      renderTrainDepartures(data);
    } else if (place.atcocode) {
      const url = apiUrl(`/bus/stop/${place.atcocode}/live.json`, {
        group: "route",
        nextbuses: "yes"
      });
      const data = await fetchJson(url);
      renderBusDepartures(data);
    } else {
      departuresList.innerHTML = `<div class="error">No live code available for this stop.</div>`;
    }
  } catch (err) {
    console.error(err);
    departuresList.innerHTML = `<div class="error">Couldn’t load departures<br>${err.message}</div>`;
  }
}

function renderBusDepartures(data) {
  const departures = data.departures || {};
  const all = [];

  Object.keys(departures).forEach((route) => {
    (departures[route] || []).forEach((d) => {
      all.push({
        line: d.line || route,
        dest: d.direction || d.destination_name || "",
        expected: d.expected_departure_time || d.best_departure_estimate || d.aimed_departure_time,
        aimed: d.aimed_departure_time,
        status: d.status || ""
      });
    });
  });

  if (all.length === 0 && Array.isArray(data.departures)) {
    data.departures.forEach((d) => all.push(d));
  }

  if (all.length === 0) {
    departuresList.innerHTML = `<div class="status">No live departures right now.</div>`;
    return;
  }

  all.sort((a, b) => (a.expected || "").localeCompare(b.expected || ""));

  departuresList.innerHTML = "";
  all.slice(0, 20).forEach((d) => {
    const t = formatTimeLabel(d.expected);
    const card = document.createElement("div");
    card.className = "departure-card";
    card.innerHTML = `
      <div class="line-badge">${d.line || "?"}</div>
      <div class="dest-block">
        <div class="dest">${d.dest || "—"}</div>
        ${d.status && d.status !== "On time" ? `<div class="extra">${d.status}</div>` : ""}
      </div>
      <div class="time-block">
        <div class="mins">${t.mins}</div>
        ${t.clock ? `<div class="clock">${t.clock}</div>` : ""}
      </div>
    `;
    departuresList.appendChild(card);
  });
}

function renderTrainDepartures(data) {
  const services = data.departures?.all || data.train_services || [];

  if (!services.length) {
    departuresList.innerHTML = `<div class="status">No trains currently listed.</div>`;
    return;
  }

  departuresList.innerHTML = "";
  services.slice(0, 20).forEach((s) => {
    const dest =
      s.destination_name ||
      (s.destination && s.destination[0]?.location_name) ||
      "";
    const expected = s.expected_departure_time || s.aimed_departure_time || s.std;
    const t = formatTimeLabel(expected);
    const platform = s.platform ? `Plat ${s.platform}` : "";
    const status = s.status && s.status !== "ON TIME" ? s.status : "";

    const card = document.createElement("div");
    card.className = "departure-card";
    card.innerHTML = `
      <div class="line-badge" style="background:#4ade80;color:#052e16;font-size:0.7rem">Train</div>
      <div class="dest-block">
        <div class="dest">${dest}</div>
        <div class="extra">${[platform, status].filter(Boolean).join(" · ")}</div>
      </div>
      <div class="time-block">
        <div class="mins">${t.mins}</div>
        ${t.clock ? `<div class="clock">${t.clock}</div>` : ""}
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

  if (favs.length === 0) {
    favEmpty.classList.remove("hidden");
    return;
  }
  favEmpty.classList.add("hidden");

  favs.forEach((f) => {
    const train = isTrainPlace(f);
    const card = document.createElement("div");
    card.className = "stop-card";
    card.innerHTML = `
      <div class="stop-icon ${train ? "train" : "bus"}">${train ? "T" : "B"}</div>
      <div class="stop-info">
        <div class="name">${f.name}</div>
        <div class="sub">${train ? "Train station" : "Bus stop"}</div>
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
    (pos) => {
      const { latitude, longitude } = pos.coords;
      setUserLocation(latitude, longitude);
      loadNearby(latitude, longitude, true);
    },
    (err) => {
      statusEl.innerHTML = `<div class="error">Location error: ${err.message}<br>Allow location access and try again.</div>`;
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

// Auto-locate on load
setTimeout(locate, 400);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
