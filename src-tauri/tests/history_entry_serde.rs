use mach_terminal_lib::models::HistoryEntry;

#[test]
fn history_entry_json_roundtrip() {
    let entry = HistoryEntry {
        id: 42,
        session_id: "session-1".to_string(),
        command: "echo hello".to_string(),
        timestamp_ms: 1_700_000_000_000,
    };
    let json = serde_json::to_string(&entry).expect("serialize");
    let parsed: HistoryEntry = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(parsed.id, entry.id);
    assert_eq!(parsed.command, entry.command);
}
