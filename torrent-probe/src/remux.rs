//! Bounded stream-copy sections for the Vega HTTP/Matroska seek workaround.
//! Reads only app-managed torrents; no subprocess or arbitrary URL proxy is used.
use crate::managed::Managed;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock,
    },
    time::Duration,
};
use tokio::sync::Semaphore;
#[cfg(target_arch = "arm")]
const MAX_BYTES: usize = 16 * 1024 * 1024;
static WORKERS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(1)));
#[derive(Deserialize)]
pub struct Options {
    start: f64,
}
fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}
pub async fn section(
    State(api): State<Arc<Managed>>,
    Path((hash, index)): Path<(String, usize)>,
    Query(options): Query<Options>,
) -> Response {
    if hash.len() != 40
        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
        || !options.start.is_finite()
        || !(0.0..=604800.0).contains(&options.start)
    {
        return error(StatusCode::BAD_REQUEST, "Invalid media section");
    }
    let Ok(permit) = WORKERS.clone().try_acquire_owned() else {
        return error(
            StatusCode::CONFLICT,
            "A media section is already being prepared",
        );
    };
    let Ok(id) = librqbit::api::TorrentIdOrHash::parse(&hash) else {
        return error(StatusCode::BAD_REQUEST, "Invalid torrent");
    };
    let size = match api.api_stream(id, index) {
        Ok(reader) => reader.len(),
        Err(_) => {
            return error(
                StatusCode::NOT_FOUND,
                "The selected torrent is no longer available. Reopen the source.",
            )
        }
    };
    let lease = match api.prepare(&hash, size).await {
        Ok(lease) => lease,
        Err(_) => {
            return error(
                StatusCode::INSUFFICIENT_STORAGE,
                "The streaming cache could not prepare this source.",
            )
        }
    };
    if api
        .api_stats_v1(id)
        .is_ok_and(|s| s.state.to_string() == "paused")
    {
        if api.api_torrent_action_start(id).await.is_err() {
            return error(
                StatusCode::CONFLICT,
                "The selected torrent could not restart.",
            );
        }
    }
    let runtime = tokio::runtime::Handle::current();
    let cancelled = Arc::new(AtomicBool::new(false));
    let _cancellation = Cancellation(cancelled.clone());
    let prepare = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let _lease = lease;
        let invoke = || {
            let reader = api.api_stream(id, index).map_err(std::io::Error::other)?;
            prepare_section(reader, options.start, &cancelled, &runtime)
        };
        let first = invoke();
        // A cold torrent reader may close before metadata/seek pieces arrive.
        // Retry once with a fresh demuxer inside the same deadline and quota.
        match first {
            Err(error)
                if error.kind() != std::io::ErrorKind::OutOfMemory
                    && !cancelled.load(Ordering::Relaxed) =>
            {
                std::thread::sleep(Duration::from_millis(500));
                if cancelled.load(Ordering::Relaxed) {
                    return Err(error);
                }
                invoke()
            }
            result => result,
        }
    });
    let prepared =
        match tokio::time::timeout(Duration::from_secs(75), prepare).await {
            Ok(Ok(Ok(bytes))) => bytes,
            Err(_) => return error(
                StatusCode::GATEWAY_TIMEOUT,
                "Preparing this part of the video timed out. Try again or choose another source.",
            ),
            _ => {
                return error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "This source could not be prepared for seeking. Try another source.",
                )
            }
        };
    let bytes = prepared.bytes;
    let Some(codecs) = codecs(&bytes) else {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "This video or audio format cannot use the seeking workaround.",
        );
    };
    let mut response = Body::from(bytes).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, "video/mp4".parse().unwrap());
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert("x-streamio-codecs", codecs.parse().unwrap());
    response.headers_mut().insert(
        "x-streamio-timestamp-offset",
        (-prepared.offset).to_string().parse().unwrap(),
    );
    if prepared.next >= 0.0 {
        response.headers_mut().insert(
            "x-streamio-next",
            prepared.next.to_string().parse().unwrap(),
        );
    }
    response
}
struct Cancellation(Arc<AtomicBool>);
struct Prepared {
    bytes: Vec<u8>,
    offset: f64,
    next: f64,
}
impl Drop for Cancellation {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}
#[cfg(target_arch = "arm")]
fn prepare_section<R: tokio::io::AsyncRead + tokio::io::AsyncSeek + Unpin>(
    reader: R,
    start: f64,
    cancelled: &AtomicBool,
    runtime: &tokio::runtime::Handle,
) -> std::io::Result<Prepared> {
    use std::ffi::c_void;
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    #[repr(C)]
    struct InputOps {
        read: extern "C" fn(*mut c_void, *mut u8, i32) -> i32,
        seek: extern "C" fn(*mut c_void, i64, i32) -> i64,
        opaque: *mut c_void,
    }
    struct Input<R> {
        reader: R,
        runtime: tokio::runtime::Handle,
        cancelled: *const AtomicBool,
        len: u64,
    }
    extern "C" fn read<R: tokio::io::AsyncRead + Unpin>(
        opaque: *mut c_void,
        bytes: *mut u8,
        size: i32,
    ) -> i32 {
        if size <= 0 || bytes.is_null() {
            return -22;
        }
        let input = unsafe { &mut *(opaque as *mut Input<R>) };
        let cancelled = unsafe { &*input.cancelled };
        let buffer = unsafe { std::slice::from_raw_parts_mut(bytes, size as usize) };
        let result = input.runtime.block_on(async {
            let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
            loop {
                if cancelled.load(Ordering::Relaxed) {
                    return Err(std::io::Error::from(std::io::ErrorKind::Interrupted));
                }
                match tokio::time::timeout(
                    Duration::from_millis(250),
                    input.reader.read(&mut *buffer),
                )
                .await
                {
                    Ok(result) => return result,
                    Err(_) if tokio::time::Instant::now() >= deadline => {
                        return Err(std::io::Error::from(std::io::ErrorKind::TimedOut))
                    }
                    Err(_) => {}
                }
            }
        });
        match result {
            Ok(0) => -541478725,
            Ok(size) => size as i32,
            Err(error) => match error.kind() {
                std::io::ErrorKind::Interrupted => -1414092869,
                std::io::ErrorKind::TimedOut => -110,
                _ => -5,
            },
        }
    }
    extern "C" fn seek<R: tokio::io::AsyncSeek + Unpin>(
        opaque: *mut c_void,
        offset: i64,
        whence: i32,
    ) -> i64 {
        let input = unsafe { &mut *(opaque as *mut Input<R>) };
        if unsafe { (&*input.cancelled).load(Ordering::Relaxed) } {
            return -1414092869;
        }
        if whence & 0x10000 != 0 {
            return i64::try_from(input.len).unwrap_or(-22);
        }
        let from = match whence & !0x20000 {
            0 if offset >= 0 => std::io::SeekFrom::Start(offset as u64),
            1 => std::io::SeekFrom::Current(offset),
            2 => std::io::SeekFrom::End(offset),
            _ => return -22,
        };
        match input.runtime.block_on(input.reader.seek(from)) {
            Ok(position) => i64::try_from(position).unwrap_or(-22),
            Err(_) => -5,
        }
    }
    unsafe extern "C" {
        fn streamio_remux_section(
            input: *const InputOps,
            start: f64,
            write: extern "C" fn(*mut c_void, *const u8, i32) -> i32,
            output: *mut c_void,
            cancel: extern "C" fn(*mut c_void) -> i32,
            cancellation: *mut c_void,
            offset: *mut f64,
            next: *mut f64,
        ) -> i32;
    }
    extern "C" fn write(output: *mut c_void, bytes: *const u8, size: i32) -> i32 {
        if size < 0 {
            return -22;
        }
        if size == 0 {
            return 0;
        }
        if bytes.is_null() {
            return -22;
        }
        let output = unsafe { &mut *(output as *mut Vec<u8>) };
        if output.len().saturating_add(size as usize) > MAX_BYTES
            || output.try_reserve(size as usize).is_err()
        {
            return -12;
        }
        output.extend_from_slice(unsafe { std::slice::from_raw_parts(bytes, size as usize) });
        size
    }
    extern "C" fn cancel(flag: *mut c_void) -> i32 {
        unsafe { (&*(flag as *const AtomicBool)).load(Ordering::Relaxed) as i32 }
    }
    let mut reader = reader;
    let len = runtime.block_on(reader.seek(std::io::SeekFrom::End(0)))?;
    runtime.block_on(reader.seek(std::io::SeekFrom::Start(0)))?;
    let mut input = Input {
        reader,
        runtime: runtime.clone(),
        cancelled: cancelled as *const _,
        len,
    };
    let ops = InputOps {
        read: read::<R>,
        seek: seek::<R>,
        opaque: &mut input as *mut _ as *mut c_void,
    };
    let mut bytes = Vec::new();
    let mut offset = 0.0;
    let mut next = -1.0;
    let result = unsafe {
        streamio_remux_section(
            &ops,
            start,
            write,
            &mut bytes as *mut _ as *mut c_void,
            cancel,
            cancelled as *const _ as *mut c_void,
            &mut offset,
            &mut next,
        )
    };
    if result < 0 {
        return Err(if result == -12 {
            std::io::Error::from(std::io::ErrorKind::OutOfMemory)
        } else {
            std::io::Error::other("Media section could not be prepared")
        });
    }
    Ok(Prepared {
        bytes,
        offset,
        next,
    })
}
#[cfg(not(target_arch = "arm"))]
fn prepare_section<R>(
    _: R,
    _: f64,
    _: &AtomicBool,
    _: &tokio::runtime::Handle,
) -> std::io::Result<Prepared> {
    Err(std::io::Error::other("The native remux module is required"))
}
fn codecs(bytes: &[u8]) -> Option<String> {
    // Never mistake a marker inside compressed media for a codec configuration.
    let mut at = 0usize;
    let header = loop {
        let prefix = bytes.get(at..at.checked_add(8)?)?;
        let mut size = u32::from_be_bytes(prefix[..4].try_into().ok()?) as usize;
        let mut payload = 8;
        if size == 1 {
            size = usize::try_from(u64::from_be_bytes(
                bytes.get(at + 8..at.checked_add(16)?)?.try_into().ok()?,
            ))
            .ok()?;
            payload = 16;
        }
        if size == 0 {
            size = bytes.len().checked_sub(at)?;
        }
        if size < payload {
            return None;
        }
        let end = at.checked_add(size)?;
        let content = bytes.get(at + payload..end)?;
        if &prefix[4..8] == b"moov" {
            break content;
        }
        at = end;
    };
    let config = |tag: &[u8; 4]| -> Option<&[u8]> {
        let at = header.windows(4).position(|b| b == tag)?;
        header.get(at + 4..)
    };
    let video = if let Some(c) = config(b"avcC").filter(|c| c.len() >= 4 && c[0] == 1) {
        format!("avc1.{:02X}{:02X}{:02X}", c[1], c[2], c[3])
    } else if let Some(c) = config(b"hvcC").filter(|c| c.len() >= 13 && c[0] == 1) {
        let space = match c[1] >> 6 {
            1 => "A",
            2 => "B",
            3 => "C",
            _ => "",
        };
        let compatibility = u32::from_be_bytes(c[2..6].try_into().ok()?).reverse_bits();
        let mut constraint = c[6..12].to_vec();
        while constraint.last() == Some(&0) {
            constraint.pop();
        }
        let suffix = constraint
            .iter()
            .map(|b| format!(".{b:02X}"))
            .collect::<String>();
        format!(
            "hev1.{space}{}.{compatibility:X}.{}{}{suffix}",
            c[1] & 31,
            if c[1] & 32 != 0 { "H" } else { "L" },
            c[12]
        )
    } else {
        return None;
    };
    let audio = if config(b"esds").is_some() {
        Some("mp4a.40.2")
    } else if config(b"dec3").is_some() {
        Some("ec-3")
    } else if config(b"dac3").is_some() {
        Some("ac-3")
    } else {
        None
    };
    Some(
        audio
            .map(|audio| format!("{video},{audio}"))
            .unwrap_or(video),
    )
}
#[cfg(test)]
mod tests {
    use super::codecs;
    fn movie(payload: &[u8]) -> Vec<u8> {
        let mut bytes = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        bytes.extend(b"moov");
        bytes.extend(payload);
        bytes
    }
    #[test]
    fn reads_avc_and_hevc_configuration() {
        assert_eq!(
            codecs(&movie(b"avcC\x01\x42\xc0\x1eesds")),
            Some("avc1.42C01E,mp4a.40.2".into())
        );
        assert_eq!(
            codecs(&movie(
                b"hvcC\x01\x01\x60\x00\x00\x00\xb0\x00\x00\x00\x00\x00\x5ddec3"
            )),
            Some("hev1.1.6.L93.B0,ec-3".into())
        );
        assert_eq!(codecs(b"avcC\x01"), None);
        assert_eq!(codecs(b"unrecognized"), None);
    }
    #[test]
    fn rejects_truncated_boxes_and_ignores_media_payload_markers() {
        let mut bytes = movie(b"avcC\x01\x42\xc0\x1eesds");
        bytes[4..8].copy_from_slice(b"mdat");
        assert_eq!(codecs(&bytes), None);
        bytes[4..8].copy_from_slice(b"moov");
        bytes.truncate(10);
        assert_eq!(codecs(&bytes), None);
        assert_eq!(
            codecs(b"\x00\x00\x00\x01moov\xff\xff\xff\xff\xff\xff\xff\xff"),
            None
        );
    }
}
