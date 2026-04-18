//! Strip escape-driven artifacts from accumulated PTY input before history / ledger.

/// Removes CSI/OSC sequences and trims so `command_submitted` payloads match what the user typed.
pub fn sanitize_command_line_for_history(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    while let Some(inner) = chars.next() {
                        if ('\x40'..='\x7e').contains(&inner) {
                            break;
                        }
                    }
                    continue;
                }
                Some(']') => {
                    chars.next();
                    while let Some(inner) = chars.next() {
                        if inner == '\u{7}' {
                            break;
                        }
                        if inner == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                    continue;
                }
                Some('(') | Some(')') => {
                    chars.next();
                    let _ = chars.next();
                    continue;
                }
                _ => continue,
            }
        }
        out.push(c);
    }

    let flat = out.chars().filter(|&c| c != '\r').collect::<String>();
    flat.lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_csi_noise() {
        let s = "\x1b[?1h\x1b[?2004hbuild\x1b[?2004l\r";
        assert_eq!(sanitize_command_line_for_history(s), "build");
    }
}
