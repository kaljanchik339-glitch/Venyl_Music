# Venyl v2.7.3 — collaboration artist import fix

Fixes the universal ZIP importer so collaboration credits create separate artist profiles and link one track to all credited artists.

Examples:
- `SLAVA MARLOW/MORGENSHTERN` -> `SLAVA MARLOW` + `MORGENSHTERN`
- `Artist feat. Artist2` -> two artist records + one track
- old combined profiles containing `/`, `feat.` or `ft.` are repaired on startup when they are importer-created collaboration names.

Single tracks without a real multi-track album remain tracks and do not create fake albums.
