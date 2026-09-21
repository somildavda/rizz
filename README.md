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

## Syncing across devices (optional)

By default, contacts live only in the current browser's `localStorage` and don't appear on other devices. To see the same folders on both desktop and phone:

1. Create a free project at https://supabase.com (free tier is enough for personal use).
2. In your Supabase project, go to the **SQL Editor** and run:
   ```sql
   create table contacts (
     id text primary key,
     sync_code text not null,
     name text,
     context text,
     interests text,
     vibe text,
     notes text,
     updated_at timestamptz
   );
   alter table contacts enable row level security;
   create policy "allow all" on contacts for all using (true) with check (true);
   ```
   The permissive policy above means anyone who has your project's URL + anon key + sync code can read/write this table — that's fine for a personal single-user app, but don't reuse a sensitive Supabase project for this, and don't share those three values.
3. In your Supabase project settings, find **Project URL** and the **anon public API key**.
4. In the app's Settings (gear icon), paste both into "Supabase URL" and "Supabase anon public key", and make up your own **sync code** (any string only you know — think of it like a password).
5. Use the *same* URL, key, and sync code on every device (desktop and phone) — that's what links them together.
6. Click "Save & sync". Contacts now push/pull automatically on every save, delete, and app open.
