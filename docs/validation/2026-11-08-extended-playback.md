# Extended playback investigation — 8 November 2026

The requested longer test found real failures. It is **not** a 30-minute
endurance pass.

## Fixed: high-bitrate keyframe section rejected

Normal source reopening failed repeatedly at the saved position 483.517 seconds.
Nearby requests succeeded. A host run of the same remux implementation, using
bounded range reads from the selected source, returned ENOMEM with no output and
no reader error. Allowing a larger temporary diagnostic input budget produced a
13,721,166-byte section, still below the existing 16 MiB output budget.

Commit 8252372 raises the retained-input bound from 12 to 16 MiB. The generated,
seeded high-bitrate fixture reproduced failure before the fix and passed after
it, with decoded output and preserved timestamps. A larger GOP still fails safely
above the hard budget. The exact device request subsequently returned HTTP 200;
normal reopening played beyond the saved position. A paused timeline jump from
595.826 to 845.826 seconds and back to 655.826 seconds also succeeded, preserving
pause, before playback resumed. The uncached forward jump needed roughly forty
seconds to prepare.

## Unresolved: native process abort during longer playback

Repeated runs returned to Fire TV Home. Lifecycle records and exported,
app-specific reports establish SIGABRT in the foreground process. One observed
run lasted about eight minutes and included intermittent buffering. The crashing
stack reaches C++ thread creation while the native player handles an app-source
need-data request (resolved with exact runtime libraries on 9 November).
Reports contained roughly 350 threads. Live samples showed growth near
28–30 threads per minute, predominantly numbered `JSThread` workers; the Rust
runtime worker group stayed small. This does not establish which native API is
retaining the workers.

Several local experiments did **not** eliminate that growth: sending MP4
initialization once, continuous fragment numbering, isolating the video surface
from UI renders, disabling unused captions, and stopping peer-statistics polling
after playback began. Those changes are preserved separately for investigation,
not published as a proven crash fix. Their parser tests and a generated joined
video-fragment decode check passed, but that is insufficient device validation.

The device became unreachable during native debugger setup. The laptop remained
on the expected home subnet. No further device checks were possible. Normal
debug-launch restoration and removal of two temporary debugger executables are
pending reconnection; a scoped local cleanup script has been prepared. The
committed normal build is prepared for restoration. No OS update was performed.

Raw crash dumps, source configuration, account details, and temporary debugger
files are kept outside the repository. Audio sync, pointer dragging, another live
MP4 source, deliberate unavailable-source recovery, and a successful 30-minute
run remain unverified in this follow-up.

## Launch restoration — 9 November

After reconnection, the temporary debug-launch configuration was cleared and the
committed normal build reinstalled. Both temporary debugger executables were
removed and their absence verified. The app was VISIBLE in the lifecycle manager,
and an actual screenshot confirmed the populated Streamio4Fire home screen.
The native long-playback abort remains unresolved; launch restoration is not an
endurance-test pass.

## Further investigation — 9 November

The exact runtime stacks and a Debug-versus-Release comparison are recorded in
[the Release playback follow-up](2026-11-09-release-playback.md). The original
thread-growth finding above describes the Debug installer used on 8 November.
