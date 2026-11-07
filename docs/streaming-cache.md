# Streaming & Cache

Open **Settings → Streaming & Cache** (the bottom-right button in Settings).
Move onto a budget with the remote arrows, move to Save, and press Select.
The dialog shows both the selected draft and the saved budget. Save closes it on
success and returns focus to Streaming & Cache. Errors leave it open with an
explanation. Back also closes it. Clear unused cache leaves the dialog open.

- Auto: up to 1.5 GiB, reduced if the system needs more free storage.
- Manual: 0.5, 1, 1.5, 2, 4 or 8 GiB. Sizes exceeding the current safe maximum
  are disabled. The backend also validates requests independently of the UI.
- System reserve: 384 MiB, protected in both budget selection and download planning.
- Clear unused cache: removes idle downloads, preserving active entries and preferences.
- A reduction that cannot fit an active download is refused without changing the
  saved preference. Idle entries may be evicted to make a smaller budget fit.

Preferences are atomically saved beside the disposable download directory in app
data. They survive cache clearing, app restarts and package updates. An interrupted
temporary save is recoverable. If available storage shrinks, the effective budget
is capped while retaining the user's requested preference.

## Engine API

The local-only engine exposes:

- `GET /cache`: disk usage, free space, system reserve, effective budget, safe
  maximum, saved preferences and storage mode.
- `POST /cache/settings`: `{ "mode": "auto", "limitBytes": null }` or
  `{ "mode": "manual", "limitBytes": 2147483648 }`.
  Unsafe or active-download-conflicting choices return HTTP 409.
- `POST /cache/clear`: clears idle entries and returns refreshed cache status.

Manual API values must be between 0.5 and 8 GiB and fit the current safe maximum.
The Stremio server settings response reports the effective budget too.

## Current limitation

This remains a **whole-file cache**, not a rolling piece cache. Movie files must
fit inside the effective budget, including download bookkeeping overhead.
Torrentio's source-size filter remains independent and is not changed by this page.
The 4GB filter can therefore still list files that exceed the Stick's available
budget. Supporting those files with a smaller disk cache remains separate work.

## Validation (2026-11-07)

- Six Rust tests passed, covering byte ranges, eviction, storage reserve,
  preference validation/persistence, interrupted saves and active-download-safe resizing.
- JavaScript navigation geometry and syntax checks passed.
- Built ARMv7 native engine/module/application and installed on the Vega Stick.
- Device UI/API: Auto initially; 2 GiB persisted across app termination/package
  update/relaunch; selecting 0.5 GiB by focus and saving stored the requested value.
- Remote-event replay: Save retained focus and clear-cache retained focus.
  Clear removed two idle entries without resetting the saved preference.
- Unsafe 4 GiB API request returned 409 on this device; 4/8 GiB UI choices disabled.
- Back event replay closed only the dialog, retained the Settings route, and
  restored focus to the Streaming & Cache button.
- Physical remote feedback identified the initial focus/selection ambiguity;
  controls were revised so focus chooses the draft budget. The user then confirmed
  that selecting and saving 2 GiB works on the physical remote.
- Follow-up device check: successful Save closes the dialog and restores launcher
  focus without changing the selected budget. A simulated HTTP 409 leaves the
  dialog open, displays the error and restores focus to Save.

No new 4GB playback claim is made by these settings tests.

## Settings button visibility

The cache button and dialog are removed whenever the route leaves Settings.
Both History API methods are observed along with hash changes, back/forward
events, and a periodic route check. Async cache responses also recheck the current
route before showing controls.

A device reproduction confirmed the old button survived a silent history route
change. After the fix, both `pushState` and `replaceState` transitions to a player
route removed the button and open dialog immediately. A delayed cache response
after leaving Settings did not recreate either control. No video was started by
these route tests.
