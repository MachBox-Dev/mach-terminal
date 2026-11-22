//! Stateful OSC 133 decoder for shell-emitted command-boundary markers.
//!
//! Matches the iTerm2 / WezTerm convention: `ESC ] 133 ; <payload> BEL` or `ST`
//! (`ESC \`) where payload begins with `A` / `B` / `C` / `D` and optional
//! arguments (notably `D;exitCode`).

const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const BACKSLASH: u8 = b'\\';
const MAX_PENDING: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Osc133Kind {
    PromptStart,
    CommandStart,
    OutputStart,
    OutputEnd {
        exit_code: Option<i32>,
    },
}

#[derive(Debug, Default)]
pub struct Osc133Parser {
    pending: Vec<u8>,
}

impl Osc133Parser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns every complete OSC 133 sequence decoded from `chunk` (in order).
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<Osc133Kind> {
        self.feed_with_offsets(chunk)
            .into_iter()
            .map(|(kind, _)| kind)
            .collect()
    }

    /// Returns every complete OSC 133 sequence decoded from `chunk` along with the
    /// byte offset in `chunk` immediately after the sequence's terminator.
    pub fn feed_with_offsets(&mut self, chunk: &[u8]) -> Vec<(Osc133Kind, usize)> {
        let prior_pending_len = self.pending.len();
        let mut work = std::mem::take(&mut self.pending);
        work.extend_from_slice(chunk);

        let mut out = Vec::new();
        let mut cursor = 0usize;

        while cursor < work.len() {
            let rest = &work[cursor..];
            let Some(esc_off) = rest.iter().position(|&b| b == ESC) else {
                break;
            };
            cursor += esc_off;

            if cursor + 6 > work.len() {
                // Not enough bytes yet to test the `ESC ] 1 3 3 ;` prefix; stash
                // from the ESC onward so the next feed can complete the prefix.
                self.pending = work[cursor..].to_vec();
                return out;
            }
            if &work[cursor + 1..cursor + 6] != b"]133;" {
                cursor += 1;
                continue;
            }

            let payload_start = cursor + 6;
            match find_terminator(&work[payload_start..]) {
                Some((payload_end_rel, term_len)) => {
                    let seq_end_in_work = payload_start + payload_end_rel + term_len;
                    let chunk_end_offset = seq_end_in_work.saturating_sub(prior_pending_len).min(chunk.len());
                    let payload = &work[payload_start..payload_start + payload_end_rel];
                    if let Some(kind) = parse_payload(payload) {
                        out.push((kind, chunk_end_offset));
                    }
                    cursor = seq_end_in_work;
                }
                None => {
                    let tail = &work[cursor..];
                    if tail.len() > MAX_PENDING {
                        self.pending.clear();
                    } else {
                        self.pending = tail.to_vec();
                    }
                    return out;
                }
            }
        }

        self.pending.clear();
        out
    }
}

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

fn trim_ascii_ws(mut s: &[u8]) -> &[u8] {
    while let Some((&first, rest)) = s.split_first() {
        if matches!(first, b' ' | b'\t' | b'\r' | b'\n') {
            s = rest;
        } else {
            break;
        }
    }
    while let Some((&last, rest)) = s.split_last() {
        if matches!(last, b' ' | b'\t' | b'\r' | b'\n') {
            s = rest;
        } else {
            break;
        }
    }
    s
}

fn parse_i32_tail(bytes: &[u8]) -> Option<i32> {
    let text = std::str::from_utf8(bytes).ok()?.trim();
    if text.is_empty() {
        return None;
    }
    text.parse::<i32>().ok()
}

fn parse_payload(payload: &[u8]) -> Option<Osc133Kind> {
    let payload = trim_ascii_ws(payload);
    if payload.is_empty() {
        return None;
    }
    match payload[0] {
        b'A' => Some(Osc133Kind::PromptStart),
        b'B' => Some(Osc133Kind::CommandStart),
        b'C' => Some(Osc133Kind::OutputStart),
        b'D' => {
            let exit_code = if payload.len() >= 3 && payload[1] == b';' {
                parse_i32_tail(&payload[2..])
            } else {
                None
            };
            Some(Osc133Kind::OutputEnd { exit_code })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_d_with_exit_bel() {
        let mut p = Osc133Parser::new();
        let got = p.feed(b"\x1b]133;D;42\x07");
        assert_eq!(
            got,
            vec![Osc133Kind::OutputEnd {
                exit_code: Some(42)
            }]
        );
    }

    #[test]
    fn decodes_abc_sequence() {
        let mut p = Osc133Parser::new();
        let mut chunk = b"\x1b]133;A\x07".to_vec();
        chunk.extend_from_slice(b"out\x1b]133;B\x07cmd\x1b]133;C\x07");
        let got = p.feed(&chunk);
        assert_eq!(
            got,
            vec![
                Osc133Kind::PromptStart,
                Osc133Kind::CommandStart,
                Osc133Kind::OutputStart,
            ]
        );
    }

    #[test]
    fn st_terminator() {
        let mut p = Osc133Parser::new();
        let got = p.feed(b"\x1b]133;D\x1b\\");
        assert_eq!(got, vec![Osc133Kind::OutputEnd { exit_code: None }]);
    }

    #[test]
    fn split_across_feeds() {
        let mut p = Osc133Parser::new();
        assert!(p.feed(b"\x1b]133;D").is_empty());
        let got = p.feed(b";1\x07");
        assert_eq!(got, vec![Osc133Kind::OutputEnd { exit_code: Some(1) }]);
    }

    #[test]
    fn ignores_other_osc() {
        let mut p = Osc133Parser::new();
        let got = p.feed(b"\x1b]0;title\x07\x1b]133;A\x07");
        assert_eq!(got, vec![Osc133Kind::PromptStart]);
    }

    #[test]
    fn esc_at_chunk_boundary_does_not_panic() {
        // ESC lands with fewer than the 5 prefix bytes remaining in the chunk.
        // Previously this read one byte past the slice end and panicked.
        let mut p = Osc133Parser::new();
        assert!(p.feed(b"output\x1b]13").is_empty());
        let got = p.feed(b"3;A\x07");
        assert_eq!(got, vec![Osc133Kind::PromptStart]);
    }

    #[test]
    fn partial_prefix_split_is_preserved() {
        let mut p = Osc133Parser::new();
        // Split immediately after ESC — only 1 of 5 prefix bytes present.
        assert!(p.feed(b"\x1b").is_empty());
        let got = p.feed(b"]133;D;7\x07");
        assert_eq!(got, vec![Osc133Kind::OutputEnd { exit_code: Some(7) }]);
    }

    #[test]
    fn feed_with_offsets_tracks_marker_positions_within_single_chunk() {
        let mut p = Osc133Parser::new();
        let chunk = b"\x1b]133;C\x07hello\n\x1b]133;D;0\x07PS> ";
        let got = p.feed_with_offsets(chunk);
        assert_eq!(
            got,
            vec![
                (Osc133Kind::OutputStart, 8),
                (Osc133Kind::OutputEnd { exit_code: Some(0) }, 24),
            ]
        );
        assert_eq!(&chunk[8..14], b"hello\n");
    }
}
