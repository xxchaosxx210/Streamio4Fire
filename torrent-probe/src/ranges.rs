/// Inclusive byte interval. Reject malformed, multi-range and out-of-bounds requests.
pub(crate) fn byte_range(
    value: Option<&str>,
    len: u64,
) -> std::result::Result<(u64, u64, bool), ()> {
    if len == 0 {
        return Err(());
    }
    let Some(value) = value else {
        return Ok((0, len - 1, false));
    };
    let (start, end) = value
        .strip_prefix("bytes=")
        .ok_or(())?
        .split_once('-')
        .ok_or(())?;
    if start.is_empty() {
        let suffix: u64 = end.parse().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        return Ok((len.saturating_sub(suffix), len - 1, true));
    }
    let start: u64 = start.parse().map_err(|_| ())?;
    let end = if end.is_empty() {
        len - 1
    } else {
        end.parse::<u64>().map_err(|_| ())?.min(len - 1)
    };
    if start >= len || start > end {
        return Err(());
    }
    Ok((start, end, true))
}
#[cfg(test)]
mod tests {
    use super::byte_range;
    #[test]
    fn video_byte_ranges_cover_seek_edges() {
        assert_eq!(byte_range(None, 100), Ok((0, 99, false)));
        assert_eq!(byte_range(Some("bytes=0-9"), 100), Ok((0, 9, true)));
        assert_eq!(byte_range(Some("bytes=90-"), 100), Ok((90, 99, true)));
        assert_eq!(byte_range(Some("bytes=-10"), 100), Ok((90, 99, true)));
        assert_eq!(byte_range(Some("bytes=90-999"), 100), Ok((90, 99, true)));
        for bad in [
            "bytes=100-",
            "bytes=20-10",
            "bytes=-0",
            "bytes=0-1,5-6",
            "bytes=18446744073709551616-",
        ] {
            assert!(byte_range(Some(bad), 100).is_err(), "{bad}");
        }
        assert!(byte_range(None, 0).is_err());
    }
}
