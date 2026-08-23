# UK Live Transit

**Location-based live UK train & bus departures**  
A mobile-first Progressive Web App (PWA) for personal use across the UK (Leeds, London, Somerset, Harrogate, Bath, and everywhere else).

Hosted on GitHub Pages – installable on your phone home screen.

## Features
- Uses your current location
- Shows nearby bus stops and train stations
- Live departure boards for buses and trains
- Clean mobile UI with interactive map
- Works offline for the app shell (PWA)

## Quick Start

### 1. Get a free API key (recommended)

**Best single key for this app:** [TransportAPI](https://developer.transportapi.com/)
- Sign up → Free plan (30 requests per day forever)
- Covers nearby places + live bus **and** train departures across Great Britain

Optional extras later:
- [Bus Open Data Service (BODS)](https://data.bus-data.dft.gov.uk/) – richer bus vehicle locations
- National Rail Darwin token via [Rail Data Marketplace](https://raildata.org.uk/)

### 2. Add your keys

Edit `config.js`:

```js
const CONFIG = {
  TRANSPORTAPI_APP_ID: "your_app_id_here",
  TRANSPORTAPI_APP_KEY: "your_app_key_here"
};
```

### 3. Enable GitHub Pages

1. Go to the repository **Settings → Pages**
2. Source: Deploy from a branch → `main` → `/ (root)`
3. Save
4. Your live app will appear at:  
   **https://winowongo2024.github.io/uk-live-transit/**

### 4. Install on phone

Open the URL on your phone → browser menu → **Add to Home Screen**.

## How it works

1. Browser asks for your location
2. TransportAPI finds nearby bus stops and train stations
3. Tap any stop/station to see live departures
4. Map shows your position and the selected stop

## Limitations (honest)

- Free TransportAPI tier = **30 requests/day**. Perfect for personal use if you don’t spam refresh.
- Real-time quality depends on operators feeding data into the national systems.
- Coverage is excellent in cities, thinner in very rural areas.

## Project structure

```
index.html      – main page
style.css       – mobile-first styles
app.js          – all logic
config.js       – your API keys (edit this)
manifest.json   – PWA install info
sw.js           – basic service worker
```

## Future ideas

- Favourites / recent stops
- BODS live vehicle dots on the map
- Simple journey planner
- Dark mode
- Better offline caching for your frequent areas

## Licence

MIT – free to use and modify.

Made for real UK travel.
