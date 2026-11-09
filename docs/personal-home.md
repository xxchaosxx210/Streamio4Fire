# Personalised home

Home now starts with Continue watching and Favourites, followed by genre filters
and the installed catalogues. The main navigation includes Library for the full
personal lists. Home shows up to twelve titles per personal row.

Open a movie or series and use **Add to favourites**. The same action removes an
existing favourite. Library also removes favourites without needing to load
title details. These are ordinary remote-focusable buttons, with a pressed
state and a star on saved cards. Favourites are limited to 100; an existing title
is never silently removed to make room for another.

Continue watching records native playback after a source starts. Cards show the
saved episode and remaining time when duration is known. Selecting one opens
the correct source list; choosing a source uses the existing saved position.
The most recent episode represents a series. Completed titles disappear, and
Library provides a Remove action for individual Continue watching entries.
Removing a card does not delete the existing resume point for manual playback.
Older resume points remain usable; titles enter the new row when played with
this build.

Genre choices come from installed movie/series catalogue manifests. Requests go
only to catalogues supporting that genre. Unsupported catalogues are omitted
while filtering; **All** restores the ordinary catalogue rows. Search is
independent of genre selection. The selected genre is part of the return route,
focus stays on the selected chip after results update, and focus identifiers
distinguish the same title appearing in multiple rows. Year-only options offered
by some catalogues are excluded from the genre rail.

The versioned local library stores bounded display metadata and progress, without
source URLs, torrent hashes or addon configuration. Corrupt data falls back to
an empty library, and unavailable/full storage produces a visible session-only
message. Favourites and history are local to this app's storage on the Stick;
Stremio account synchronisation and upstream browser-player history import are
not implemented.

## Checks

`frontend-tv/library.test.cjs` checks persistence, metadata sanitisation,
completion, episode replacement, malformed storage, quota failure and catalogue
genre compatibility. It runs with the pinned frontend's TypeScript compiler via
`NODE_PATH`, alongside `api.test.cjs` in `scripts/build.sh`.

The production frontend and ARM Release package build successfully. The wrapper
TypeScript check passes. The upstream frontend's broad TypeScript check still
reports errors outside `StreamioTV`; no TV-frontend errors were reported.

On 9 November, device checks verified adding a favourite, its Home/Library
appearance, retention across updates and restarts, and removal through Library.
Injected remote input selected Action, loaded movie/series genre results and
kept the selected chip focused. A real native playback session returned to Home
with a Continue watching card, progress and a remaining-time label.
The card survived relaunch and opened the correct source list. The final device
check also verified the personal-card focus outline after overriding inherited
overflow clipping. Temporary test favourites and history entries were removed.
Unit checks cover episode identity and completion; a live series episode cycle was not
tested in this change.

`prepare-tv-assets.py` now fingerprints bundled script/style references by file
content. The device initially retained older CSS despite the package containing
the new file; changed asset URLs loaded the correct styles without clearing app
data. The preparation regression checks changed URLs, idempotence, preservation
of existing query parameters, bootstrap injection and untouched external URLs.
