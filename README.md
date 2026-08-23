# UK Live Transit

**Map-first live UK bus departures & vehicle tracking**  
No API keys. No daily limits. Works across Great Britain.

Live site (after enabling Pages):  
**https://winowongo2024.github.io/uk-live-transit/**

## Features

- Full-screen dark map
- Your location + nearby bus stops
- **Pan / zoom the map** → stops refresh automatically
- **Live bus positions** on the map (updates every 20s)
- Live departure boards (“X min” style)
- Favourites (saved on your phone)
- Installable as a PWA

## Data source

Powered by **[bustimes.org](https://bustimes.org)** – a community project that aggregates open UK bus data (including BODS).

- No API key required
- No hard daily request limit (the app debounces map moves so we stay polite)
- Excellent coverage of buses across England, Scotland & Wales

> Note: This version focuses on **buses**. Train support can be added later if needed.

## Setup

1. Enable **GitHub Pages**:
   - Settings → Pages → Source: `main` branch → `/ (root)`
2. Open the Pages URL on your phone → **Add to Home Screen**

That’s it – no keys to configure.

## How to use

1. Allow location when asked (or tap ◎)
2. Nearby stops appear in the bottom sheet and as dots on the map
3. **Drag the map** – stops and live buses update for the new area
4. Tap a stop → live departure board
5. Tap ☆ to favourite a stop (★ button to view favourites)

## Be a good citizen

bustimes.org is a free community service. The app already:
- Debounces map moves (waits ~0.7s after you stop panning)
- Limits how many markers it draws
- Refreshes vehicles every 20 seconds (not constantly)

Please don’t modify it to spam the endpoints.

## Licence

MIT
