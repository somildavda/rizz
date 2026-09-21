# Rizz Assistant

A personal, free, browser-based conversation assistant. You keep a folder of notes on each person you talk to (yourself — nothing is scraped or auto-collected), paste in a message they sent you, and get reply suggestions.

## How it works

- **Folders**: one per person, holding notes you type in yourself (how you met, interests, vibe, free notes).
- **Reply Assistant**: paste a message they sent you and get suggestions pulled from a built-in library of openers/lines, filtered by the vibe you set for that person.
- **Sharpen with AI** (optional): if you add your own Anthropic API key in Settings, this calls Claude directly from your browser to tailor suggestions to your notes + their message. Your key is stored only in this browser's `localStorage` and sent only to Anthropic's API, directly from your device.

## Data & privacy

- Everything (contacts, notes, API key) is stored in your browser's `localStorage`. Nothing is sent to any server except the direct, optional call to Anthropic's API when you click "Sharpen with AI".
- No chat exports, contact scraping, or web/OSINT lookups are performed by this app. All notes are things you type in yourself.

## Running it

This is a static site — no build step, no backend.

```
cd rizz
python3 -m http.server 8000
# open http://localhost:8000
```

Or just open `index.html` directly in a browser.

To use on your phone: host it for free on GitHub Pages, Netlify, or Vercel, then open the URL on your phone and "Add to Home Screen" for an app-like experience.

## Getting an Anthropic API key (optional)

Only needed for "Sharpen with AI". Create one at https://console.anthropic.com — note this has a small per-use cost on Anthropic's side; the base app (local suggestions) is fully free.
