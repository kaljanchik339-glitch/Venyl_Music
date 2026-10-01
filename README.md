# Venyl

Готовая версия проекта с новым `public/index.html`, рабочими API и хранением данных в `data/venyl.json`.

## Запуск

```bash
npm start
```

После запуска открой:

```text
http://localhost:3000
```

## Что внутри

- новый дизайн находится в `public/index.html`;
- серверные API находятся в `server.js`;
- треки, артисты, альбомы и пользователи хранятся в `data/venyl.json`;
- загруженные аудио/обложки лежат в `uploads/`;
- SQLite больше не нужен, поэтому проект не ломается из-за `better-sqlite3`.

## Важно

Админ определяется через `ADMIN_EMAIL` в `.env`. Чтобы загружать треки, войди под этим email.

## Safe local setup

1. Copy `.env.example` to `.env` and fill in local secrets. Never commit `.env`, `data/`, `uploads/`, or `node_modules/`.
2. Install dependencies with `npm install`.
3. Run the app with `npm start`.
4. For syntax checking use `npm run check`.

Production secrets belong in Render environment variables, not in Git.

## V2.3 Social Pulse

Adds derived social activity without introducing new database tables: friends listening now, a following feed, and notifications for follows, comments, favorites, playlist likes, and unread chat messages. These features use existing persisted data and therefore remain compatible with the current Supabase bootstrap.


## v2.4 Discover & Search
- Added a dedicated Discover page with trending tracks, new releases, popular artists and albums.
- Added server endpoint `/api/discover`.
- Preserved Supabase bootstrap and existing auth/social systems.


## Venyl v2.5 — Advanced Player & Radio

- Venyl Radio with adaptive queue scoring and repeat avoidance.
- Media Session integration for system playback controls.
- 10-second seek backward/forward.
- Playback speed controls with local persistence.
- Sleep timer.
- Radio mode is clearly reflected in the compact player.

Keep `.env`, `data/`, `uploads/`, and `node_modules/` out of Git.


## Venyl v2.6
- Music Wrapped and richer personal stats
- Collaborative playlists via optional playlist_collaborators table
- Run supabase-v2.6.sql once in Supabase SQL editor to enable persistent collaborators


## v2.6.2 fixes
- Added working admin track/album edit modals.
- Added playlist public/private toggle and server persistence.
- Profile bio is saved and shown on public profiles.
- Collaborative playlists now support nickname search instead of manual numeric IDs.
- Wrapped is wired directly into My Music rendering.

## v2.7.4 — Track & Album Cover Editing
- Admins can replace a track cover from the existing track editor.
- Admins can replace an album cover from the existing album editor.
- Existing cover previews are shown when opening the editor.
- Replacing an album cover updates tracks that inherit the album cover.
- Replacing a track cover does not delete a shared album cover.
