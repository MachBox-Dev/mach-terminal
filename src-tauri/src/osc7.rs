//! Stateful OSC 7 decoder used by the PTY reader thread to track live shell CWD.
//!
//! OSC 7 is the de-facto way for a shell to tell its host "I just changed directory".
//! It looks like: `ESC ] 7 ; file://<host>/<path> <terminator>` where the terminator is
//! either a BEL (`0x07`) or a two-byte ST (`ESC \`). Bash / zsh / fish / PowerShell all
//! emit it via a short PROMPT_COMMAND / precmd / prompt hook once the user opts in.
//!
//! The parser is deliberately tolerant:
//! - Non-OSC bytes are ignored.
//! - A sequence split across two `feed()` calls still resolves (we buffer tail bytes).
//! - Malformed payloads return `None` rather than poisoning the stream.
//! - The pending buffer is hard-capped so a malicious stream that opens `ESC ] 7 ;`
//!   and never terminates cannot grow unbounded.
//!
//! Output: `feed()` returns `Some(decoded_path)` whenever a *complete* sequence is
//! observed. If multiple sequences land in the same chunk we only surface the last
//! (current cwd) since earlier sequences are stale by the time we emit.

const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const BACKSLASH: u8 = b'\\';
/// Cap for in-progress OSC 7 bytes to keep a malformed stream bounded.
/// A real filesystem path rarely exceeds 4 KiB even with percent-encoding; anything
/// beyond this is either garbage or an attempt to wedge the parser.
const MAX_PENDING: usize = 4096;

/// Incremental OSC 7 scanner. Owns a small rolling buffer holding bytes from the
/// end of the previous `feed()` chunk that *might* complete on the next call.
#[derive(Debug, Default)]
pub struct Osc7Parser {
    pending: Vec<u8>,
}

impl Osc7Parser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Consume a slice of PTY output bytes, return the most-recently decoded absolute
    /// path if at least one complete `OSC 7` sequence terminates inside `chunk`.
    pub fn feed(&mut self, chunk: &[u8]) -> Option<String> {
        // Concatenating with the carry keeps the state machine simple at the cost of
        // a small memcpy; PTY chunks are already bounded by MAX_CHUNK in the reader.
        let mut work = std::mem::take(&mut self.pending);
        work.extend_from_slice(chunk);

        let mut last: Option<String> = None;
        let mut cursor = 0usize;

        while cursor < work.len() {
            // Skip bytes that are not the start of an OSC introducer.
            let rest = &work[cursor..];
            let Some(esc_off) = rest.iter().position(|&b| b == ESC) else {
                // No ESC in the remainder: safe to discard everything we've seen.
                break;
            };
            cursor += esc_off;

            // Need at least `ESC ] 7 ;` (4 bytes) to decide.
            if cursor + 4 > work.len() {
                break;
            }
            if &work[cursor + 1..cursor + 4] != b"]7;" {
                // Some other OSC / CSI / escape; skip just the ESC and keep scanning.
                cursor += 1;
                continue;
            }

            let payload_start = cursor + 4;
            match find_terminator(&work[payload_start..]) {
                Some((payload_end_rel, term_len)) => {
                    let payload = &work[payload_start..payload_start + payload_end_rel];
                    if let Some(decoded) = decode_payload(payload) {
                        last = Some(decoded);
                    }
                    cursor = payload_start + payload_end_rel + term_len;
                }
                None => {
                    // Incomplete sequence: stash the tail (including the ESC) and wait
                    // for the next chunk. Drop the carry if it is obviously runaway so
                    // we cannot accumulate forever.
                    let tail = &work[cursor..];
                    if tail.len() > MAX_PENDING {
                        self.pending.clear();
                    } else {
                        self.pending = tail.to_vec();
                    }
                    return last;
                }
            }
        }

        // All bytes were consumed (either matched or discarded); nothing to carry.
        self.pending.clear();
        last
    }
}

/// Return `(end_index_in_slice, terminator_byte_count)` for either a BEL or ST
/// terminator, whichever comes first.
fn find_terminator(slice: &[u8]) -> Option<(usize, usize)> {
    for (i, &byte) in slice.iter().enumerate() {
        if byte == BEL {
            return Some((i, 1));
        }
        if byte == ESC && slice.get(i + 1) == Some(&BACKSLASH) {
            return Some((i, 2));
        }
    }
    None
}

/// Decode the payload between `;` and the terminator into an absolute filesystem path.
/// Returns `None` on empty / non-`file://` / malformed percent-encoding.
pub fn decode_payload(payload: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(payload).ok()?;
    // OSC 7 canonically starts `file://`. Some shells drop the host segment entirely
    // and emit `file:///path`; others include `file://hostname/path`. We accept both
    // and discard the host since we have no cross-host file semantics.
    let after_scheme = text.strip_prefix("file://")?;
    let path_start = match after_scheme.find('/') {
        Some(idx) => idx,
        None => {
            // `file://hostname` with no path is meaningless for cwd tracking.
            return None;
        }
    };
    let raw_path = &after_scheme[path_start..];
    if raw_path.is_empty() {
        return None;
    }

    let decoded_bytes = percent_decode(raw_path.as_bytes())?;
    let decoded = String::from_utf8(decoded_bytes).ok()?;
    if decoded.is_empty() {
        return None;
    }

    Some(normalize_path(&decoded))
}

/// RFC 3986 percent-decoder for path bytes. Rejects truncated escapes (`%` or `%A` at
/// end) and non-hex nibbles so a malformed payload returns `None` end-to-end.
fn percent_decode(input: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        if input[i] == b'%' {
            if i + 2 >= input.len() {
                return None;
            }
            let hi = hex_nibble(input[i + 1])?;
            let lo = hex_nibble(input[i + 2])?;
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(input[i]);
            i += 1;
        }
    }
    Some(out)
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Canonicalize the decoded path for the host platform. On Windows the payload comes
/// in as `/C:/Users/mike` after percent-decoding; strip the leading slash and swap
/// forward slashes for backslashes so downstream `PathBuf` / `CommandBuilder::cwd`
/// consumers get a native path. Other platforms keep the path verbatim.
#[cfg(target_os = "windows")]
fn normalize_path(decoded: &str) -> String {
    let trimmed = if decoded.starts_with('/')
        && decoded.len() >= 3
        && decoded.as_bytes()[2] == b':'
        && decoded.as_bytes()[1].is_ascii_alphabetic()
    {
        &decoded[1..]
    } else {
        decoded
    };
    trimmed.replace('/', "\\")
}

#[cfg(not(target_os = "windows"))]
fn normalize_path(decoded: &str) -> String {
    decoded.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_osc7(path: &str, terminator: &[u8]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"\x1b]7;file://host");
        buf.extend_from_slice(path.as_bytes());
        buf.extend_from_slice(terminator);
        buf
    }

    #[test]
    fn decodes_ascii_path_with_bel_terminator() {
        let mut parser = Osc7Parser::new();
        let chunk = make_osc7("/home/mike", b"\x07");
        let got = parser.feed(&chunk);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(got.as_deref(), Some("/home/mike"));
        #[cfg(target_os = "windows")]
        assert_eq!(got.as_deref(), Some("\\home\\mike"));
    }

    #[test]
    fn decodes_ascii_path_with_st_terminator() {
        let mut parser = Osc7Parser::new();
        let chunk = make_osc7("/tmp", b"\x1b\\");
        let got = parser.feed(&chunk);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(got.as_deref(), Some("/tmp"));
        #[cfg(target_os = "windows")]
        assert_eq!(got.as_deref(), Some("\\tmp"));
    }

    #[test]
    fn decodes_percent_encoded_space() {
        let mut parser = Osc7Parser::new();
        let chunk = make_osc7("/path%20with%20space", b"\x07");
        let got = parser.feed(&chunk);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(got.as_deref(), Some("/path with space"));
        #[cfg(target_os = "windows")]
        assert_eq!(got.as_deref(), Some("\\path with space"));
    }

    #[test]
    fn decodes_non_ascii_utf8_via_percent_encoding() {
        let mut parser = Osc7Parser::new();
        // U+2713 CHECK MARK -> UTF-8 E2 9C 93
        let chunk = make_osc7("/%E2%9C%93/done", b"\x07");
        let got = parser.feed(&chunk);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(got.as_deref(), Some("/\u{2713}/done"));
        #[cfg(target_os = "windows")]
        assert_eq!(got.as_deref(), Some("\\\u{2713}\\done"));
    }

    #[test]
    fn accepts_empty_host_segment() {
        // `file:///absolute/path` form (empty host).
        let mut parser = Osc7Parser::new();
        let chunk = b"\x1b]7;file:///etc\x07";
        let got = parser.feed(chunk);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(got.as_deref(), Some("/etc"));
        #[cfg(target_os = "windows")]
        assert_eq!(got.as_deref(), Some("\\etc"));
    }

    #[test]
    fn resolves_sequence_split_across_two_feeds() {
        let mut parser = Osc7Parser::new();
        let full = make_osc7("/home/split", b"\x07");
        let (first, second) = full.split_at(10);
        assert!(parser.feed(first).is_none());
        let got = parser.feed(second);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(got.as_deref(), Some("/home/split"));
        #[cfg(target_os = "windows")]
        assert_eq!(got.as_deref(), Some("\\home\\split"));
    }

    #[test]
    fn keeps_only_the_last_sequence_in_a_single_chunk() {
        let mut parser = Osc7Parser::new();
        let mut chunk = make_osc7("/first", b"\x07");
        chunk.extend_from_slice(b"noise between");
        chunk.extend_from_slice(&make_osc7("/second", b"\x07"));
        let got = parser.feed(&chunk);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(got.as_deref(), Some("/second"));
        #[cfg(target_os = "windows")]
        assert_eq!(got.as_deref(), Some("\\second"));
    }

    #[test]
    fn ignores_non_osc7_escape_sequences() {
        let mut parser = Osc7Parser::new();
        let chunk = b"regular output\x1b[31mred\x1b[0m still nothing";
        assert!(parser.feed(chunk).is_none());
        assert!(parser.pending.is_empty());
    }

    #[test]
    fn malformed_payload_returns_none_but_does_not_break_parser() {
        let mut parser = Osc7Parser::new();
        // Truncated percent escape: `%2` at end.
        let chunk = b"\x1b]7;file:///bad%2\x07";
        assert!(parser.feed(chunk).is_none());
        // A follow-up valid sequence must still resolve.
        let ok = make_osc7("/ok", b"\x07");
        let got = parser.feed(&ok);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(got.as_deref(), Some("/ok"));
        #[cfg(target_os = "windows")]
        assert_eq!(got.as_deref(), Some("\\ok"));
    }

    #[test]
    fn rejects_non_file_scheme() {
        let mut parser = Osc7Parser::new();
        let chunk = b"\x1b]7;http://example.com/path\x07";
        assert!(parser.feed(chunk).is_none());
    }

    #[test]
    fn osc7_embedded_between_normal_output() {
        let mut parser = Osc7Parser::new();
        let mut chunk = b"prompt$ ".to_vec();
        chunk.extend_from_slice(&make_osc7("/mid", b"\x07"));
        chunk.extend_from_slice(b"more output");
        let got = parser.feed(&chunk);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(got.as_deref(), Some("/mid"));
        #[cfg(target_os = "windows")]
        assert_eq!(got.as_deref(), Some("\\mid"));
    }

    #[test]
    fn overflow_guard_drops_runaway_incomplete_sequence() {
        let mut parser = Osc7Parser::new();
        // Start an OSC 7 but never terminate; pad past MAX_PENDING.
        let mut chunk = Vec::with_capacity(MAX_PENDING + 64);
        chunk.extend_from_slice(b"\x1b]7;file://host");
        chunk.extend(std::iter::repeat(b'/').take(MAX_PENDING));
        assert!(parser.feed(&chunk).is_none());
        assert!(
            parser.pending.is_empty(),
            "oversized pending buffer should be dropped"
        );
    }

    #[test]
    fn percent_decode_rejects_bad_nibble() {
        assert!(percent_decode(b"%ZZ").is_none());
        assert!(percent_decode(b"%A").is_none());
        assert!(percent_decode(b"%").is_none());
    }

    #[test]
    fn decode_payload_rejects_host_without_path() {
        assert!(decode_payload(b"file://host").is_none());
        assert!(decode_payload(b"notfile://host/path").is_none());
        assert!(decode_payload(b"").is_none());
    }
}
