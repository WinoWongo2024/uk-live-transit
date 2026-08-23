# UK Live Transit

**Map-first live UK train & bus departures**  
Inspired by the First Bus app experience. Works across the whole of Great Britain (Leeds, London, Somerset, Harrogate, Bath…).

Live demo (after you enable Pages):  
**https://winowongo2024.github.io/uk-live-transit/**

## What’s new

- Full-screen dark map (Carto dark tiles)
- Bottom sheet with nearby stops
- **Pan / zoom the map** → stops update automatically
- Live departure boards with “X min” countdown style
- **Favourites** (saved on your phone via localStorage)
- Cleaner, more modern mobile UI

## Features

| Feature | Status |
|---------|--------|
| Your location | ✅ |
| Nearby bus stops + train stations | ✅ |
| Live departures | ✅ |
| Map updates when you pan | ✅ |
| Favourites | ✅ (local) |
| Real-time bus vehicle dots | 🔜 (needs BODS key + extra work) |
| Account / cloud sync | 🔜 (possible with free Firebase later) |

## Setup

1. Your TransportAPI keys are already in `config.js`.
2. Enable **GitHub Pages**:
   - Settings → Pages → Source: `main` branch → `/ (root)`
3. Open the Pages URL on your phone → **Add to Home Screen**.

## How to use

1. Allow location when asked (or tap the ◎ button).
2. Nearby stops appear in the bottom sheet and as dots on the map.
3. **Drag the map** – stops refresh for the new area.
4. Tap a stop → live departure board.
5. Tap ☆ to save as favourite. Access favourites with the ★ button.

## Limits (honest)

- TransportAPI free tier = **30 requests/day**.  
  Panning the map uses requests, so don’t spam it all day.
- Live bus *vehicle* tracking (moving bus icons) needs the free BODS API + a bit more code. We can add it next.
- No real login yet – favourites stay on the device. Cloud sync can be added later with a free Firebase project if you want.

## Next possible upgrades

- Live bus positions on the map (BODS)
- Simple journey planner
- Cloud favourites + optional login
- Service alerts

## Licence

MIT
