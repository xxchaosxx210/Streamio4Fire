# Startup recovery

A reported blank screen was inspected on 2026-11-07. The embedded engine still
answered HTTP requests, but the document remained in the loading state with only
the beginning of its HTML parsed. A full application termination and relaunch
restored the home interface. The precise underlying renderer/network cause has
not been established; the service worker was investigated but was not confirmed
as the cause. No accounts, addons or cache preferences were reset.

The wrapper now:

- Shows a loading message after the native engine is ready.
- Recreates the WebView when starting/resuming the engine.
- Shows a native Retry button if loading has not completed after 20 seconds.
- Shows the same recovery control on main-page load or HTTP errors.
- Remounts the local frontend when Retry is pressed, preserving app data.
- Gives the WebView explicit flex sizing.

This is a recovery safeguard, not a claim that every possible blank-screen cause
has been eliminated. A fully loaded frontend with an internal rendering fault is
different from the observed stalled document and may require further investigation.

Validation: TypeScript passed. Four component tests passed for stalled load/retry,
successful load cancellation of the timeout, main-frame versus subresource
HTTP errors, and auxiliary network errors. Transient network errors do not
immediately destroy the WebView; the loading timeout determines when recovery
is necessary. Run `npx --no-install jest --config jest.startup.config.json --runInBand`
inside `torrent-probe/stremio-wrapper` after installing SDK dependencies.

On-device checks: the rebuilt application launched the home interface. Navigating
to a deliberately missing local page produced the native HTTP 404 recovery screen.
The user pressed Select on Retry and confirmed returning to the Stremio home
screen. The button's focused appearance was then changed to retain readable text
and a cyan border, rather than appearing disabled.

## Bundled frontend entry

A subsequent launcher reopen still stalled, so the recovery control alone was
insufficient. The frontend is now built with upstream's
`SERVICE_WORKER_DISABLED=true` setting. The native entry URL is `/app/`, outside
the old `/upnp/ui/` worker scope. Both paths serve bundled assets for compatibility.
The origin remains `http://127.0.0.1:11470`, retaining origin-scoped app data.
No localStorage, IndexedDB, addons or saved cache preferences are cleared.

This avoids the redundant website offline cache for native bundled assets; the
original low-level cause of the stalled renderer has not been proven.

Verification: six Rust tests, four startup component tests, seven addon-link
cases and TypeScript passed. The installed app reported `/app/`, a complete home
document and no controlling service worker. The previous registration remained
scoped to `/upnp/ui/`, confirming scope separation without clearing user data.
The user then pressed Fire TV Home and reopened Streamio4Fire from its icon,
confirming normal launch without Retry.

## Keyboard focus lifecycle

The wrapper previously called engine start and remounted its WebView for every
`active` notification, including notifications without a preceding background.
That could discard an in-progress search when a system overlay returned focus.
It now restarts only after an actual `background` event; inactive/active and
duplicate active notifications leave the current WebView and engine untouched.
Lifecycle transitions are logged without search text to aid device diagnosis.

Two additional component tests cover preserving the loaded page across
inactive/active and duplicate active notifications, and restarting once after a
genuine background return. Six wrapper tests and TypeScript passed.
After installing this build, the user repeated the on-screen-keyboard search and
confirmed that pressing OK keeps the search/results screen visible.
