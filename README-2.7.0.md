# Venyl 2.7.0 — Bulk Album Import

Adds an admin-only ZIP album importer.

## How to use
1. Open Admin → Upload Music.
2. Choose a ZIP containing MP3/WAV/FLAC/OGG/M4A files and optionally `cover.jpg`.
3. Venyl reads ID3 metadata automatically: title, artist, album, track number and genre.
4. The album, artists, cover and audio files are created in the existing Venyl JSON/Supabase persistence flow.
5. Imported audio is playable through the normal Venyl player.

ZIP uploads are limited to 500 MB. The existing single-track upload remains available.


## v2.7.1 — Universal library ZIP import

Upload one ZIP containing unrelated tracks. Venyl reads ID3 tags, groups tracks by album artist and album, puts missing-album tracks into Singles, shows a preview before import, warns about missing metadata and duplicates, and keeps the old direct import endpoint compatible.
