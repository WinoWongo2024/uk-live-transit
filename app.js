// UK Live Transit – core logic
// Uses TransportAPI (free tier) for places + live departures

const statusEl = document.getElementById("status");
const stopsSection = document.getElementById("stopsSection");
const stopsList = document.getElementById("stopsList");
const departuresSection = document.getElementById("departuresSection");
const departuresList = document.getElementById("departuresList");
const selectedStopName = document.getElementById("selectedStopName");
const locateBtn = document.getElementById("locateBtn");
const backBtn = document.getElementById("backBtn");

let map = null;
let userMarker = null;
let stopMarkers = [];
let currentLat = null;
let currentLon = null;

// ---------- Map ----------
function initMap() {
  map = L.map("map", {
    zoomControl: false,
    attributionControl: false
  }).setView([54.0, -2.0], 6); // UK overview

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);
}

function setUserLocation(lat, lon) {
  currentLat = lat;
  currentLon = lon;

  if (userMarker) map.removeLayer(userMarker);

  userMarker = L.circleMarker([lat, lon], {
    radius: 8,
    fillColor: "#38bdf8",
    color: "#fff",
    weight: 2,
    fillOpacity: 0.9
  }).addTo(map).bindPopup("You are here");

  map.setView([lat, lon], 15);
}

function clearStopMarkers() {
  stopMarkers.forEach(m => map.removeLayer(m));
  stopMarkers = [];
}

// ---------- API helpers ----------
function hasKeys() {
  return CONFIG.TRANSPORTAPI_APP_ID && CONFIG.TRANSPORTAPI_APP_KEY;
}

function apiUrl(path, params = {}) {
  const base = "https://transportapi.com/v3/uk";
  const url = new URL(base + path);
  url.searchParams.set("app_id", CONFIG.TRANSPORTAPI_APP_ID);
  url.searchParams.set("app_key", CONFIG.TRANSPORTAPI_APP_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

// ---------- Nearby stops ----------
async function findNearbyStops(lat, lon) {
  statusEl.innerHTML = `<span class="spinner"></span> Finding nearby stops…`;
  stopsSection.classList.add("hidden");
  departuresSection.classList.add("hidden");
  clearStopMarkers();

  // Request both bus stops and train stations
  const url = apiUrl("/places.json", {
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    type: "bus_stop,train_station",
    rpp: 20
  });

  try {
    const data = await fetchJson(url);
    const places = data.member || [];

    if (places.length === 0) {
      statusEl.textContent = "No stops found nearby. Try a more central location.";
      return;
    }

    // Sort by distance if available, otherwise keep order
    places.sort((a, b) => (a.distance || 0) - (b.distance || 0));

    renderStops(places);
    statusEl.textContent = `${places.length} stops found near you`;
  } catch (err) {
    console.error(err);
    statusEl.innerHTML = `<div class="error">Could not load stops.<br>${err.message}</div>`;
  }
}

function renderStops(places) {
  stopsList.innerHTML = "";
  stopsSection.classList.remove("hidden");

  places.forEach(place => {
    const isTrain = (place.type || "").includes("train") || (place.station_code);
    const typeLabel = isTrain ? "Train" : "Bus";
    const typeClass = isTrain ? "train" : "bus";
    const dist = place.distance ? `${Math.round(place.distance)} m` : "";

    const card = document.createElement("div");
    card.className = "stop-card";
    card.innerHTML = `
      <div class="name">${place.name || "Unknown stop"}</div>
      <div class="meta">${dist}${place.accuracy ? " · " + place.accuracy : ""}</div>
      <span class="type ${typeClass}">${typeLabel}</span>
    `;

    card.addEventListener("click", () => showDepartures(place));
    stopsList.appendChild(card);

    // Marker on map
    if (place.latitude && place.longitude) {
      const marker = L.circleMarker([place.latitude, place.longitude], {
        radius: 6,
        fillColor: isTrain ? "#22c55e" : "#38bdf8",
        color: "#fff",
        weight: 1,
        fillOpacity: 0.9
      }).addTo(map);

      marker.bindPopup(`<b>${place.name}</b><br>${typeLabel}`);
      stopMarkers.push(marker);
    }
  });
}

// ---------- Live departures ----------
async function showDepartures(place) {
  stopsSection.classList.add("hidden");
  departuresSection.classList.remove("hidden");
  selectedStopName.textContent = place.name || "Departures";
  departuresList.innerHTML = `<div class="status"><span class="spinner"></span> Loading departures…</div>`;

  // Centre map on the stop
  if (place.latitude && place.longitude) {
    map.setView([place.latitude, place.longitude], 16);
  }

  try {
    let data;
    const isTrain = (place.type || "").includes("train") || place.station_code;

    if (isTrain && place.station_code) {
      // Train station live board
      const url = apiUrl(`/train/station/${place.station_code}/live.json`, {
        darwin: "true",
        train_status: "passenger"
      });
      data = await fetchJson(url);
      renderTrainDepartures(data);
    } else if (place.atcocode) {
      // Bus stop live board
      const url = apiUrl(`/bus/stop/${place.atcocode}/live.json`, {
        group: "route",
        nextbuses: "yes"
      });
      data = await fetchJson(url);
      renderBusDepartures(data);
    } else {
      // Fallback – try to use the place id if available
      departuresList.innerHTML = `<div class="error">This stop does not have a usable live code yet.</div>`;
    }
  } catch (err) {
    console.error(err);
    departuresList.innerHTML = `<div class="error">Could not load departures.<br>${err.message}</div>`;
  }
}

function renderBusDepartures(data) {
  const departures = data.departures || {};
  const all = [];

  // TransportAPI groups by route
  Object.keys(departures).forEach(route => {
    (departures[route] || []).forEach(d => {
      all.push({
        line: d.line || route,
        direction: d.direction || d.aimed_departure_time || "",
        expected: d.expected_departure_time || d.aimed_departure_time,
        status: d.status || "",
        aimed: d.aimed_departure_time
      });
    });
  });

  // Flatten alternative structure some responses use
  if (all.length === 0 && Array.isArray(data.departures)) {
    data.departures.forEach(d => all.push(d));
  }

  if (all.length === 0) {
    departuresList.innerHTML = `<div class="status">No live departures right now.</div>`;
    return;
  }

  // Sort by expected time if possible
  all.sort((a, b) => (a.expected || "").localeCompare(b.expected || ""));

  departuresList.innerHTML = "";
  all.slice(0, 15).forEach(d => {
    const card = document.createElement("div");
    card.className = "departure-card";
    card.innerHTML = `
      <div class="line">${d.line || "?"}</div>
      <div class="dest">${d.direction || d.destination_name || ""}</div>
      <div class="time">
        <div class="due">${formatTime(d.expected)}</div>
        ${d.aimed && d.aimed !== d.expected ? `<div class="scheduled">sch ${formatTime(d.aimed)}</div>` : ""}
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
  services.slice(0, 15).forEach(s => {
    const dest = s.destination_name || (s.destination && s.destination[0]?.location_name) || "";
    const platform = s.platform || "";
    const status = s.status || "";
    const expected = s.expected_departure_time || s.aimed_departure_time || s.std;

    const card = document.createElement("div");
    card.className = "departure-card";
    card.innerHTML = `
      <div class="line">${s.operator || s.service || "Train"}</div>
      <div class="dest">
        ${dest}
        ${platform ? `<div class="platform">Plat ${platform}</div>` : ""}
        ${status && status !== "ON TIME" ? `<div class="platform">${status}</div>` : ""}
      </div>
      <div class="time">
        <div class="due">${formatTime(expected)}</div>
      </div>
    `;
    departuresList.appendChild(card);
  });
}

function formatTime(t) {
  if (!t) return "—";
  // Already HH:MM or similar
  if (t.length <= 5) return t;
  // ISO style
  try {
    const d = new Date(t);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return t;
  }
}

// ---------- Geolocation ----------
function locate() {
  if (!hasKeys()) {
    statusEl.innerHTML = `
      <div class="error">
        Please add your free TransportAPI keys in <code>config.js</code><br>
        Get them at <a href="https://developer.transportapi.com/" target="_blank" style="color:#38bdf8">developer.transportapi.com</a>
      </div>`;
    return;
  }

  if (!navigator.geolocation) {
    statusEl.textContent = "Geolocation is not supported by this browser.";
    return;
  }

  statusEl.innerHTML = `<span class="spinner"></span> Getting your location…`;
  locateBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      setUserLocation(latitude, longitude);
      findNearbyStops(latitude, longitude);
      locateBtn.disabled = false;
    },
    (err) => {
      console.error(err);
      statusEl.innerHTML = `<div class="error">Location error: ${err.message}<br>Please allow location access and try again.</div>`;
      locateBtn.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000
    }
  );
}

// ---------- Events ----------
locateBtn.addEventListener("click", locate);
backBtn.addEventListener("click", () => {
  departuresSection.classList.add("hidden");
  stopsSection.classList.remove("hidden");
  if (currentLat && currentLon) {
    map.setView([currentLat, currentLon], 15);
  }
});

// ---------- Init ----------
initMap();

// Register service worker for PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(console.warn);
}
