//! Embedded diagnostic runtime for the Vega native module.
mod adapter;
mod cache;
mod cache_settings;
mod managed;
mod ranges;
mod remux;
mod rolling;
#[cfg(any(test, feature = "rolling-selftest"))]
pub mod rolling_tests;
use librqbit::{Session, SessionOptions};
use std::{
    ffi::{c_char, CString},
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::Duration,
};
use tokio::sync::oneshot;

struct Running {
    url: CString,
    stop: oneshot::Sender<()>,
    thread: thread::JoinHandle<()>,
}
static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();

fn start() -> anyhow::Result<Running> {
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let (stop_tx, stop_rx) = oneshot::channel();
    let thread = thread::Builder::new()
        .name("torrent-runtime".into())
        .spawn(move || {
            let result = (|| -> anyhow::Result<()> {
                let runtime = tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(2)
                    .enable_all()
                    .build()?;
                runtime.block_on(async move {
                    let _ = tracing_subscriber::fmt()
                        .with_env_filter("info")
                        .with_ansi(false)
                        .try_init();
                    // /data is persistent and private to the Vega app; /tmp is RAM-backed.
                    let storage = std::path::PathBuf::from("/data/torrent-probe-cache");
                    let mut cache = cache::Cache::new(storage.clone(), cache::LIMIT)?;
                    let preferences = cache_settings::Preferences::load(
                        &cache.root.with_extension("settings.json"),
                    )
                    .unwrap_or_default();
                    let disk = cache.entries()?.iter().map(|e| e.disk).sum();
                    cache.limit = preferences.effective(cache_settings::maximum(
                        disk,
                        managed::free_space(&cache.root)?,
                    ));
                    let victims = cache
                        .plan(
                            "",
                            0,
                            managed::free_space(&cache.root)?,
                            &Default::default(),
                        )
                        .unwrap_or_else(|_| {
                            cache
                                .entries()
                                .unwrap_or_default()
                                .into_iter()
                                .map(|e| e.hash)
                                .collect()
                        });
                    for hash in victims {
                        cache.remove(&hash)?;
                    }
                    let session = Session::new_with_opts(
                        storage,
                        SessionOptions {
                            disable_dht_persistence: true,
                            enable_upnp_port_forwarding: false,
                            listen_port_range: None,
                            trackers: [
                                "udp://tracker.opentrackr.org:1337/announce",
                                "udp://open.stealth.si:80/announce",
                                "udp://tracker.torrent.eu.org:451/announce",
                            ]
                            .into_iter()
                            .filter_map(|s| url::Url::parse(s).ok())
                            .collect(),
                            ..Default::default()
                        },
                    )
                    .await?;
                    let listener = tokio::net::TcpListener::bind("127.0.0.1:11470").await?;
                    let managed = managed::Managed::new(session.clone(), cache);
                    let housekeeping = managed.clone();
                    let worker = tokio::spawn(async move {
                        loop {
                            tokio::time::sleep(Duration::from_secs(5)).await;
                            housekeeping.pause_idle().await;
                        }
                    });
                    let app = adapter::router(managed);
                    let _ = ready_tx.send(());
                    tokio::select! {
                        result = axum::serve(listener, app) => result?,
                        _ = stop_rx => {},
                    }
                    worker.abort();
                    session.stop().await;
                    Ok(())
                })
            })();
            if let Err(error) = result {
                eprintln!("TORRENT_RUNTIME_ERROR {error:#}");
            }
        })?;
    ready_rx.recv_timeout(Duration::from_secs(10))?;
    Ok(Running {
        // The legacy website service worker owns /upnp/ui/. Keep native bundled
        // assets outside its scope while retaining the origin's user data.
        url: CString::new("http://127.0.0.1:11470/app/")?,
        stop: stop_tx,
        thread,
    })
}

#[no_mangle]
pub extern "C" fn vega_tv_start() -> *const c_char {
    // FFI must never unwind into the C++ host.
    std::panic::catch_unwind(|| {
        let Ok(mut guard) = RUNNING.get_or_init(|| Mutex::new(None)).lock() else {
            return std::ptr::null();
        };
        if guard.is_none() {
            match start() {
                Ok(running) => *guard = Some(running),
                Err(error) => {
                    eprintln!("TORRENT_START_ERROR {error:#}");
                    return std::ptr::null();
                }
            }
        }
        guard.as_ref().unwrap().url.as_ptr()
    })
    .unwrap_or(std::ptr::null())
}

#[no_mangle]
pub extern "C" fn vega_tv_stop() {
    let _ = std::panic::catch_unwind(|| {
        let Ok(mut guard) = RUNNING.get_or_init(|| Mutex::new(None)).lock() else {
            return;
        };
        if let Some(running) = guard.take() {
            let _ = running.stop.send(());
            let _ = running.thread.join();
        }
    });
}
