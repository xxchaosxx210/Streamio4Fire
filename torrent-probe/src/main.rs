//! Device feasibility probe; this is not a Stremio-compatible server yet.
use anyhow::Context;
use librqbit::{api::Api, http_api::HttpApi, Session, SessionOptions};
use std::{net::Ipv4Addr, path::PathBuf};

#[tokio::main(worker_threads = 2)]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_ansi(false)
        .init();
    let storage = PathBuf::from(
        std::env::args()
            .nth(1)
            .context("Pass a writable test-cache directory")?,
    );
    std::fs::create_dir_all(&storage).context("create test cache")?;
    let session = Session::new_with_opts(
        storage,
        SessionOptions {
            disable_dht_persistence: true,
            enable_upnp_port_forwarding: false,
            listen_port_range: None,
            ..Default::default()
        },
    )
    .await
    .context("start torrent session")?;
    // Local-only control and playback; never expose the API to the LAN.
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 11470))
        .await
        .context("bind loopback API")?;
    println!("TORRENT_PROBE_READY http://127.0.0.1:11470");
    let server = HttpApi::new(Api::new(session.clone(), None, None), None);
    tokio::select! {
        result = server.make_http_api_and_run(listener, None) => result?,
        result = tokio::signal::ctrl_c() => result?,
    }
    session.stop().await;
    Ok(())
}
