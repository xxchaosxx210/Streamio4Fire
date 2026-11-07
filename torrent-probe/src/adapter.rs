use crate::managed::{Guarded, Managed};
use crate::ranges::byte_range;
// Small Stremio server-protocol adapter. It does not implement transcoding.
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use librqbit::{api::TorrentIdOrHash, AddTorrent, AddTorrentOptions};
use serde_json::{json, Value};
use std::{io::SeekFrom, sync::Arc, time::Duration};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

type Failure = (StatusCode, Json<Value>);
type Result<T> = std::result::Result<T, Failure>;
fn failure(error: impl std::fmt::Display) -> Failure {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error":error.to_string()})),
    )
}
fn hash_id(hash: &str) -> Result<TorrentIdOrHash> {
    if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(failure("Expected a 40-character torrent info hash"));
    }
    TorrentIdOrHash::parse(hash).map_err(failure)
}

pub fn router(managed: Arc<Managed>) -> Router {
    Router::new()
        .route("/diagnostic-addon/manifest.json", get(|| async { Json(json!({
            "id":"com.firetvdiagnostics.licensed-torrent","version":"0.1.0","name":"Licensed Torrent Test",
            "description":"Development fixture: Big Buck Bunny, Creative Commons Attribution 3.0.",
            "resources":["catalog","meta","stream"],"types":["movie"],"idPrefixes":["vega-bbb"],
            "catalogs":[{"type":"movie","id":"licensed","name":"Licensed Torrent Test"}]
        })) }))
        .route("/diagnostic-addon/catalog/movie/licensed.json", get(|| async { Json(json!({"metas":[fixture_meta()]})) }))
        .route("/diagnostic-addon/meta/movie/vega-bbb.json", get(|| async { Json(json!({"meta":fixture_meta()})) }))
        .route("/diagnostic-addon/stream/movie/vega-bbb.json", get(|| async { Json(json!({"streams":[{
            "name":"Native torrent test","title":"1080p — Big Buck Bunny (CC BY)",
            "infoHash":"dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c","fileIdx":1,
            "sources":["tracker:udp://tracker.opentrackr.org:1337/announce"]
        }]})) }))
        .route("/", get(|| async { Json(json!({"server":"vega-rqbit-adapter","version":"0.2.0"})) }))
        .route("/settings", get(settings))
        .route("/cache", get(cache_status))
        .route("/cache/clear", post(cache_clear))
        .route("/cache/release", post(cache_release))
        .route("/casting", get(|| async { Json(json!([])) }))
        .route("/device-info", get(|| async { Json(json!({"availableHardwareAccelerations":[]})) }))
        .route("/network-info", get(|| async { Json(json!({"availableInterfaces":[]})) }))
        .route("/create", post(create_blob))
        .route("/{hash}/create", post(create_magnet))
        .route("/{hash}/stats.json", get(stats_all))
        .route("/{hash}/{idx}/stats.json", get(stats_file))
        .route("/{hash}/{idx}", get(stream))
        .route("/torrents/{hash}/stats/v1", get(diagnostic_stats))
        .nest_service("/upnp/ui", tower_http::services::ServeDir::new("/pkg/assets/stremio"))
        .route_service("/tv.js", tower_http::services::ServeFile::new("/pkg/assets/stremio/vega-tv.js"))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .with_state(managed)
}

fn storage_failure(error: impl std::fmt::Display) -> Failure {
    (
        StatusCode::INSUFFICIENT_STORAGE,
        Json(json!({"error":error.to_string()})),
    )
}
async fn cache_status(State(api): State<Arc<Managed>>) -> Result<Json<Value>> {
    Ok(Json(api.status().map_err(failure)?))
}
async fn cache_clear(State(api): State<Arc<Managed>>) -> Result<Json<Value>> {
    let removed = api.clear_idle().await.map_err(failure)?;
    Ok(Json(
        json!({"removed":removed,"cache":api.status().map_err(failure)?}),
    ))
}
async fn cache_release(State(api): State<Arc<Managed>>) -> Json<Value> {
    api.release().await;
    Json(json!({"ok":true}))
}

fn fixture_meta() -> Value {
    json!({"id":"vega-bbb","type":"movie","name":"Big Buck Bunny — native torrent test",
        "description":"Blender Foundation open movie, CC BY 3.0. Tests addon selection through the embedded torrent engine.",
        "releaseInfo":"2008","runtime":"10 min","website":"https://peach.blender.org/"})
}

async fn settings() -> Json<Value> {
    Json(
        json!({"baseUrl":"http://127.0.0.1:11470/","options":[],"values":{
            "appPath":"/pkg","cacheRoot":"/data/torrent-probe-cache","serverVersion":"0.2.0-vega-rqbit",
            "remoteHttps":null,"transcodeProfile":null,"cacheSize":1610612736,"proxyStreamsEnabled":false,
            "btMaxConnections":128,"btHandshakeTimeout":10000,"btRequestTimeout":10000,
            "btDownloadSpeedSoftLimit":0,"btDownloadSpeedHardLimit":0,"btMinPeersForStable":1
        }}),
    )
}

fn sources(body: &Value) -> Vec<String> {
    body.pointer("/peerSearch/sources")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|s| s.strip_prefix("tracker:"))
        .filter(|s| s.len() <= 4096)
        .filter_map(|s| url::Url::parse(s).ok())
        .filter(|u| matches!(u.scheme(), "http" | "https" | "udp"))
        .take(32)
        .map(|u| u.to_string())
        .collect()
}

async fn ensure(
    api: &Managed,
    hash: &str,
    trackers: Vec<String>,
    file: Option<usize>,
) -> Result<TorrentIdOrHash> {
    let id = hash_id(hash)?;
    let lock = api.metadata_lock(hash);
    let _lookup = lock.lock().await;
    if api.api_torrent_details(id).is_ok() {
        return Ok(id);
    }
    let folder = api.cache.path(hash).map_err(failure)?;
    let cached = std::fs::read(folder.join(".torrent")).ok();
    let mut magnet = url::Url::parse("magnet:?").map_err(failure)?;
    magnet
        .query_pairs_mut()
        .append_pair("xt", &format!("urn:btih:{hash}"));
    for tracker in &trackers {
        magnet.query_pairs_mut().append_pair("tr", tracker);
    }
    let lookup = async {
        let options = || {
            Some(AddTorrentOptions {
                list_only: true,
                ..Default::default()
            })
        };
        if let Some(bytes) = cached {
            return api
                .session()
                .add_torrent(AddTorrent::from_bytes(bytes), options())
                .await;
        }
        let peers = api
            .session()
            .add_torrent(AddTorrent::from_url(magnet.as_str()), options());
        // Metadata only; the content hash is verified below before any download starts.
        let public_cache = async {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let url = format!(
                "https://itorrents.org/torrent/{}.torrent",
                hash.to_ascii_uppercase()
            );
            api.session()
                .add_torrent(AddTorrent::from_url(&url), options())
                .await
        };
        tokio::pin!(peers);
        tokio::pin!(public_cache);
        tokio::select! {
            result=&mut peers=>match result {Ok(value)=>Ok(value),Err(_)=>public_cache.await},
            result=&mut public_cache=>match result {Ok(value)=>Ok(value),Err(_)=>peers.await},
        }
    };
    let response = tokio::time::timeout(Duration::from_secs(75), lookup)
        .await
        .map_err(|_| {
            let message = "Could not retrieve torrent metadata. Try a source with more peers.";
            api.error_for(hash, message.into());
            failure(message)
        })?
        .map_err(|e| {
            api.error_for(hash, format!("Torrent metadata failed: {e}"));
            failure(e)
        })?;
    let meta = match response {
        librqbit::AddTorrentResponse::ListOnly(meta) => meta,
        _ => return Err(failure("Unexpected torrent metadata response")),
    };
    if meta.info_hash.as_string() != hash.to_ascii_lowercase() {
        return Err(failure("Cached torrent hash mismatch"));
    }
    let folder = api.cache.path(hash).map_err(failure)?;
    std::fs::write(folder.join(".torrent"), &meta.torrent_bytes).map_err(failure)?;
    let selected = file.or_else(|| meta.info.length.map(|_| 0));
    if let Some(index) = selected {
        let size = meta
            .info
            .iter_file_lengths()
            .map_err(failure)?
            .nth(index)
            .ok_or_else(|| failure("File index not found"))?;
        if size.saturating_add(crate::cache::OVERHEAD) > api.cache.limit {
            let message = "Selected file exceeds the 1.5 GiB cache limit; choose a smaller stream";
            api.error_for(hash, message.into());
            return Err(storage_failure(message));
        }
    }
    api.api_add_torrent(
        AddTorrent::from_bytes(meta.torrent_bytes),
        Some(AddTorrentOptions {
            paused: true,
            overwrite: true,
            output_folder: Some(folder.to_string_lossy().to_string()),
            initial_peers: Some(meta.seen_peers),
            trackers: if trackers.is_empty() {
                None
            } else {
                Some(trackers)
            },
            ..Default::default()
        }),
    )
    .await
    .map_err(failure)?;
    Ok(id)
}
fn created(hash: &str) -> Json<Value> {
    Json(json!({"torrent":{"infoHash":hash},"peerSearch":{
        "min":0,"max":128,"sources":[format!("dht:{hash}")]},"guessFileIdx":false}))
}
async fn create_magnet(
    State(api): State<Arc<Managed>>,
    Path(hash): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    api.begin_selection(&hash);
    let id = ensure(&api, &hash, sources(&body), None).await?;
    let mut result = created(&hash).0;
    if body.get("guessFileIdx").is_some_and(Value::is_object) {
        if body.pointer("/guessFileIdx/episode").is_some() {
            return Err(failure("Episode auto-selection is not implemented; choose a stream with an explicit file index"));
        }
        let details =
            serde_json::to_value(api.api_torrent_details(id).map_err(failure)?).map_err(failure)?;
        let files = details["files"]
            .as_array()
            .ok_or_else(|| failure("Torrent has no files"))?;
        let best = files
            .iter()
            .enumerate()
            .filter(|(_, f)| {
                let name = f["name"].as_str().unwrap_or("").to_ascii_lowercase();
                [".mp4", ".mkv", ".webm", ".m4v", ".avi", ".mov", ".ts"]
                    .iter()
                    .any(|ext| name.ends_with(ext))
            })
            .max_by_key(|(_, f)| f["length"].as_u64().unwrap_or(0))
            .map(|(i, _)| i)
            .ok_or_else(|| failure("No supported video filename found"))?;
        result["guessedFileIdx"] = json!(best);
    }
    Ok(Json(result))
}
async fn create_blob(
    State(api): State<Arc<Managed>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let _gate = api.gate.lock().await;
    let blob = body
        .get("blob")
        .and_then(Value::as_str)
        .ok_or_else(|| failure("Missing hex torrent blob"))?;
    let bytes = hex::decode(blob).map_err(failure)?;
    let result = api
        .api_add_torrent(
            AddTorrent::from_bytes(bytes.clone()),
            Some(AddTorrentOptions {
                paused: true,
                overwrite: true,
                list_only: true,
                ..Default::default()
            }),
        )
        .await
        .map_err(failure)?;
    let value = serde_json::to_value(result).map_err(failure)?;
    let hash = value
        .pointer("/details/info_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| failure("Missing torrent hash"))?;
    hash_id(hash)?;
    api.api_add_torrent(
        AddTorrent::from_bytes(bytes),
        Some(AddTorrentOptions {
            paused: true,
            overwrite: true,
            output_folder: Some(
                api.cache
                    .path(hash)
                    .map_err(failure)?
                    .to_string_lossy()
                    .to_string(),
            ),
            ..Default::default()
        }),
    )
    .await
    .map_err(failure)?;
    Ok(created(hash))
}

async fn diagnostic_stats(
    State(api): State<Arc<Managed>>,
    Path(hash): Path<String>,
) -> Result<Json<Value>> {
    let id = if hash.bytes().all(|b| b.is_ascii_digit()) && hash.len() < 10 {
        TorrentIdOrHash::parse(&hash).map_err(failure)?
    } else {
        hash_id(&hash)?
    };
    Ok(Json(
        serde_json::to_value(api.api_stats_v1(id).map_err(failure)?).map_err(failure)?,
    ))
}
async fn stats_all(
    State(api): State<Arc<Managed>>,
    Path(hash): Path<String>,
) -> Result<Json<Value>> {
    statistics(&api, &hash, None).await
}
async fn stats_file(
    State(api): State<Arc<Managed>>,
    Path((hash, idx)): Path<(String, usize)>,
) -> Result<Json<Value>> {
    statistics(&api, &hash, Some(idx)).await
}
async fn statistics(api: &Managed, hash: &str, idx: Option<usize>) -> Result<Json<Value>> {
    let id = hash_id(hash)?;
    let details =
        serde_json::to_value(api.api_torrent_details(id).map_err(failure)?).map_err(failure)?;
    let raw = serde_json::to_value(api.api_stats_v1(id).map_err(failure)?).map_err(failure)?;
    let mut offset = 0u64;
    let files: Vec<Value> = details["files"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|f| {
            let len = f["length"].as_u64().unwrap_or(0);
            let file = json!({"name":f["name"],"path":f["name"],"length":len,"offset":offset});
            offset += len;
            file
        })
        .collect();
    let selected = idx.and_then(|i| files.get(i));
    let length = selected.and_then(|f| f["length"].as_u64());
    let progress = idx.and_then(|i| raw["file_progress"][i].as_u64());
    let peers = raw
        .pointer("/live/snapshot/peer_stats/live")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    Ok(Json(json!({
        "name":details["name"],"infoHash":hash,"files":files,"sources":[],
        "opts":{"connections":null,"dht":true,"growler":{"flood":0,"pulse":null},
            "handshakeTimeout":10000,"path":"/data/torrent-probe-cache",
            "peerSearch":{"min":0,"max":128,"sources":[format!("dht:{hash}")]},
            "swarmCap":{"maxSpeed":null,"minPeers":null},"timeout":10000,"tracker":true,"virtual":false},
        "downloadSpeed":raw.pointer("/live/download_speed/mbps").and_then(Value::as_f64).unwrap_or(0.0)*1048576.0,
        "uploadSpeed":raw.pointer("/live/upload_speed/mbps").and_then(Value::as_f64).unwrap_or(0.0)*1048576.0,
        "downloaded":raw["progress_bytes"],"uploaded":raw["uploaded_bytes"],
        "unchoked":peers,"peers":peers,"queued":0,"unique":peers,"connectionTries":0,
        "peerSearchRunning":!raw["finished"].as_bool().unwrap_or(false),
        "streamLen":length,"streamName":selected.map(|f| f["name"].clone()),
        "streamProgress":length.zip(progress).map(|(l,p)|p as f64/l.max(1) as f64),
        "swarmConnections":peers,"swarmPaused":raw["state"]=="paused","swarmSize":peers
    })))
}

async fn stream(
    State(api): State<Arc<Managed>>,
    Path((hash, idx)): Path<(String, usize)>,
    headers: HeaderMap,
) -> Result<Response> {
    api.begin_selection(&hash);
    let id = ensure(&api, &hash, vec![], Some(idx)).await?;
    tokio::time::timeout(Duration::from_secs(75), async {
        while api.api_stats_v1(id).map_err(failure)?.state.to_string() == "initializing" {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Ok::<(), Failure>(())
    })
    .await
    .map_err(|_| failure("Torrent initialization timed out"))??;
    let details =
        serde_json::to_value(api.api_torrent_details(id).map_err(failure)?).map_err(failure)?;
    let size = details["files"][idx]["length"]
        .as_u64()
        .ok_or_else(|| failure("File index not found"))?;
    let lease = api.prepare(&hash, size).await.map_err(|error| {
        let message = error.to_string();
        api.set_error(message.clone());
        storage_failure(message)
    })?;
    api.api_torrent_action_update_only_files(id, &vec![idx].into_iter().collect())
        .await
        .map_err(failure)?;
    // A newly created torrent is paused until a specific file is requested.
    if api.api_stats_v1(id).map_err(failure)?.state.to_string() == "paused" {
        api.api_torrent_action_start(id).await.map_err(failure)?;
    }
    let mut file = api.api_stream(id, idx).map_err(failure)?;
    let len = file.len();
    let range = match headers.get(header::RANGE).map(|v| v.to_str()).transpose() {
        Ok(value) => byte_range(value, len),
        Err(_) => Err(()),
    };
    let (start, end, partial) = match range {
        Ok(r) => r,
        Err(_) => {
            return Ok((
                StatusCode::RANGE_NOT_SATISFIABLE,
                [(header::CONTENT_RANGE, format!("bytes */{len}"))],
            )
                .into_response())
        }
    };
    file.seek(SeekFrom::Start(start)).await.map_err(failure)?;
    let mut response = Body::from_stream(Guarded {
        inner: ReaderStream::with_capacity(file.take(end - start + 1), 65536),
        _lease: lease,
    })
    .into_response();
    *response.status_mut() = if partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let h = response.headers_mut();
    h.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    h.insert(
        header::CONTENT_LENGTH,
        (end - start + 1).to_string().parse().unwrap(),
    );
    if let Ok(mime) = api.torrent_file_mime_type(id, idx) {
        if let Ok(mime) = mime.parse() {
            h.insert(header::CONTENT_TYPE, mime);
        }
    }
    if partial {
        h.insert(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{len}").parse().unwrap(),
        );
    }
    Ok(response)
}
