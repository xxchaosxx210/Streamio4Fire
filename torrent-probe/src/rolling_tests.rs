//! Deterministic real BitTorrent peer, synthetic data, and a >4GiB logical file.
//! No public swarm, credentials or movie download is used by these tests.
use super::rolling::{Control, Factory};
use librqbit::{
    storage::StorageFactoryExt, AddTorrent, AddTorrentOptions, Session, SessionOptions,
};
use std::{
    fs,
    io::SeekFrom,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    net::TcpListener,
};

const PIECE: usize = 1024 * 1024;
const CAPACITY: u64 = 8 * PIECE as u64;
const LENGTH: u64 = 4 * 1024 * 1024 * 1024 + 12345;
fn torrent(prefix: Option<u64>) -> (Vec<u8>, [u8; 20]) {
    let hashes: Vec<_> = (0..251)
        .map(|i| {
            ring::digest::digest(
                &ring::digest::SHA1_FOR_LEGACY_USE_ONLY,
                &vec![i as u8; PIECE],
            )
        })
        .collect();
    let count = LENGTH.div_ceil(PIECE as u64) as usize;
    let mut pieces = Vec::new();
    for i in 0..count {
        let size = (LENGTH - i as u64 * PIECE as u64).min(PIECE as u64) as usize;
        if size == PIECE {
            pieces.extend_from_slice(hashes[i % 251].as_ref());
        } else {
            pieces.extend_from_slice(
                ring::digest::digest(
                    &ring::digest::SHA1_FOR_LEGACY_USE_ONLY,
                    &vec![(i % 251) as u8; size],
                )
                .as_ref(),
            );
        }
    }
    let mut info = match prefix {
        None => format!("d6:lengthi{LENGTH}e4:name9:video.mp412:piece lengthi{PIECE}e6:pieces{}:", pieces.len()),
        Some(prefix) => format!("d5:filesld6:lengthi{prefix}e4:pathl10:prefix.bineed6:lengthi{}e4:pathl9:video.mp4eee4:name5:multi12:piece lengthi{PIECE}e6:pieces{}:", LENGTH-prefix, pieces.len()),
    }.into_bytes();
    info.extend(pieces);
    info.push(b'e');
    let hash: [u8; 20] = ring::digest::digest(&ring::digest::SHA1_FOR_LEGACY_USE_ONLY, &info)
        .as_ref()
        .try_into()
        .unwrap();
    let mut bytes = b"d4:info".to_vec();
    bytes.extend(info);
    bytes.push(b'e');
    (bytes, hash)
}
async fn verify<T: tokio::io::AsyncRead + tokio::io::AsyncSeek + Unpin>(
    file: &mut T,
    start: u64,
    length: usize,
    prefix: u64,
) {
    file.seek(SeekFrom::Start(start)).await.unwrap();
    let mut data = vec![0; length];
    tokio::time::timeout(Duration::from_secs(25), file.read_exact(&mut data))
        .await
        .expect("rolling stream stalled")
        .unwrap();
    for (i, byte) in data.iter().enumerate() {
        assert_eq!(
            *byte,
            (((prefix + start + i as u64) / PIECE as u64) % 251) as u8,
            "incorrect byte at {}",
            start + i as u64
        );
    }
}

pub async fn run() {
    run_layout(None).await;
    run_layout(Some(PIECE as u64 - 3)).await;
}
async fn run_layout(prefix: Option<u64>) {
    let (bytes, hash) = torrent(prefix);
    let file_index = usize::from(prefix.is_some());
    let prefix = prefix.unwrap_or(0);
    let base = if cfg!(target_arch = "arm") {
        std::path::PathBuf::from("/data")
    } else {
        std::env::temp_dir()
    };
    let root = base.join(format!(
        "streamio-rolling-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let zero_requests = Arc::new(AtomicU64::new(0));
    let requests = zero_requests.clone();
    let seed = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            socket.set_nodelay(true).unwrap();
            let requests = requests.clone();
            tokio::spawn(async move {
                let result: anyhow::Result<()> = async {
                    let mut handshake = [0; 68];
                    socket.read_exact(&mut handshake).await?;
                    anyhow::ensure!(&handshake[28..48] == hash, "wrong info hash");
                    let mut reply = b"\x13BitTorrent protocol".to_vec();
                    reply.extend([0; 8]);
                    reply.extend(hash);
                    reply.extend(b"01234567890123456789");
                    socket.write_all(&reply).await?;
                    let pieces = LENGTH.div_ceil(PIECE as u64) as usize;
                    let mut bitfield = vec![255u8; pieces.div_ceil(8)];
                    if pieces % 8 != 0 {
                        *bitfield.last_mut().unwrap() &= 255 << (8 - pieces % 8);
                    }
                    socket.write_u32((bitfield.len() + 1) as u32).await?;
                    socket.write_u8(5).await?;
                    socket.write_all(&bitfield).await?;
                    socket.write_all(&[0, 0, 0, 1, 1]).await?; // unchoke
                    loop {
                        let length = socket.read_u32().await? as usize;
                        if length == 0 {
                            continue;
                        }
                        anyhow::ensure!(length <= 1024 * 1024, "oversized peer message");
                        let mut frame = vec![0; length];
                        socket.read_exact(&mut frame).await?;
                        if frame[0] != 6 {
                            continue;
                        }
                        anyhow::ensure!(length == 13, "bad request");
                        let index = u32::from_be_bytes(frame[1..5].try_into().unwrap());
                        let begin = u32::from_be_bytes(frame[5..9].try_into().unwrap());
                        let amount = u32::from_be_bytes(frame[9..13].try_into().unwrap());
                        anyhow::ensure!(
                            amount <= 16384
                                && index as u64 * PIECE as u64 + begin as u64 + amount as u64
                                    <= LENGTH,
                            "invalid requested range"
                        );
                        if index == 0 {
                            requests.fetch_add(1, Ordering::Relaxed);
                        }
                        socket.write_u32(amount + 9).await?;
                        socket.write_u8(7).await?;
                        socket.write_u32(index).await?;
                        socket.write_u32(begin).await?;
                        socket
                            .write_all(&vec![(index % 251) as u8; amount as usize])
                            .await?;
                    }
                }
                .await;
                let _ = result; // expected EOF when the session closes
            });
        }
    });
    let control = Control::new(CAPACITY);
    let session = Session::new_with_opts(
        root.clone(),
        SessionOptions {
            disable_dht: true,
            disable_dht_persistence: true,
            enable_upnp_port_forwarding: false,
            listen_port_range: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let handle = session
        .add_torrent(
            AddTorrent::from_bytes(bytes.clone()),
            Some(AddTorrentOptions {
                overwrite: true,
                initial_peers: Some(vec![address]),
                storage_factory: Some(
                    Factory {
                        root: root.clone(),
                        control: control.clone(),
                    }
                    .boxed(),
                ),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .into_handle()
        .unwrap();
    handle.wait_until_initialized().await.unwrap();
    let mut stream = handle.clone().stream(file_index).unwrap();
    for block in 0..24 {
        verify(&mut stream, block * PIECE as u64, PIECE, prefix).await;
    }
    assert!(control.evictions.load(Ordering::Relaxed) > 0);
    verify(&mut stream, 3 * 1024 * 1024 * 1024 + 17, PIECE + 29, prefix).await;
    verify(&mut stream, LENGTH - prefix - 65539, 65539, prefix).await;
    verify(&mut stream, 0, PIECE, prefix).await;
    assert!(
        zero_requests.load(Ordering::Relaxed) >= 128,
        "backward seek did not download the evicted first piece again"
    );
    let mut other = handle.clone().stream(file_index).unwrap();
    tokio::join!(
        verify(&mut stream, 32 * PIECE as u64 + 123, 2 * PIECE, prefix),
        verify(&mut other, 3 * 1024 * 1024 * 1024 + 789, 2 * PIECE, prefix)
    );
    let piece_dir = root.join("pieces");
    assert!(fs::read_dir(&piece_dir).unwrap().count() <= 8);
    use std::os::unix::fs::MetadataExt;
    let allocated: u64 = fs::read_dir(&piece_dir)
        .unwrap()
        .map(|e| e.unwrap().metadata().unwrap().blocks() * 512)
        .sum();
    assert!(
        allocated <= CAPACITY,
        "disk allocation exceeded budget: {allocated}"
    );
    assert!(!root.join("video.mp4").exists());
    drop(stream);
    drop(other);
    session.stop().await;
    drop(handle);
    drop(session);
    // A restarted session must not trust a previous run's disposable piece map.
    let restart = Session::new_with_opts(
        root.clone(),
        SessionOptions {
            disable_dht: true,
            disable_dht_persistence: true,
            enable_upnp_port_forwarding: false,
            listen_port_range: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let again = restart
        .add_torrent(
            AddTorrent::from_bytes(bytes),
            Some(AddTorrentOptions {
                overwrite: true,
                initial_peers: Some(vec![address]),
                storage_factory: Some(
                    Factory {
                        root: root.clone(),
                        control: Control::new(CAPACITY),
                    }
                    .boxed(),
                ),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .into_handle()
        .unwrap();
    again.wait_until_initialized().await.unwrap();
    let before = zero_requests.load(Ordering::Relaxed);
    let mut reopened = again.clone().stream(file_index).unwrap();
    verify(&mut reopened, 0, PIECE, prefix).await;
    assert!(zero_requests.load(Ordering::Relaxed) >= before + 64);
    drop(reopened);
    restart.stop().await;
    drop(again);
    drop(restart);
    seed.abort();
    fs::remove_dir_all(root).unwrap();
}

#[cfg(test)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn real_peer_streams_large_file_with_eviction_and_backward_seek() {
    run().await;
}

#[cfg(test)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn http_ranges_accept_large_movies_with_a_smaller_cache_budget() {
    let root = std::env::temp_dir().join(format!("streamio-rolling-http-{}", std::process::id()));
    let cache = crate::cache::Cache::new(root.join("downloads"), crate::cache::LIMIT).unwrap();
    let session = Session::new_with_opts(
        cache.root.clone(),
        SessionOptions {
            disable_dht: true,
            disable_dht_persistence: true,
            enable_upnp_port_forwarding: false,
            listen_port_range: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let managed = crate::managed::Managed::new(session.clone(), cache);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = crate::adapter::router(managed);
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();
    let response = client
        .post(format!("{base}/cache/settings"))
        .json(&serde_json::json!({"mode":"manual","limitBytes":crate::cache_settings::MIN_LIMIT}))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let (bytes, hash) = torrent(None);
    let response = client
        .post(format!("{base}/create"))
        .json(&serde_json::json!({"blob":hex::encode(bytes)}))
        .send()
        .await
        .unwrap();
    assert!(
        response.status().is_success(),
        "{}",
        response.text().await.unwrap()
    );
    let response = client
        .head(format!("{base}/{}/0", hex::encode(hash)))
        .header("Range", format!("bytes={}-", LENGTH - 1024))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 206);
    assert_eq!(response.headers()["content-length"], "1024");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(
        response.headers()["content-range"],
        format!("bytes {}-{}/{LENGTH}", LENGTH - 1024, LENGTH - 1)
    );
    let status: serde_json::Value = client
        .get(format!("{base}/cache"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["storageMode"], "rolling");
    assert_eq!(status["reservedBytes"], crate::cache_settings::MIN_LIMIT);
    assert!(status["diskBytes"].as_u64().unwrap() < 1024 * 1024);
    server.abort();
    session.stop().await;
    fs::remove_dir_all(root).unwrap();
}
